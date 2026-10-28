//! Embedded Swift bridge to Apple's on-device SystemLanguageModel.
use super::local::LocalProviderInfo;
use bytes::Bytes;
use serde_json::{json, Value};
use std::convert::Infallible;
use tokio::sync::mpsc;

pub async fn availability() -> LocalProviderInfo {
    let mut info = LocalProviderInfo {
        id: "apple-foundation".into(),
        name: "Apple Foundation Models".into(),
        installed: cfg!(apple_foundation_available),
        available: false,
        path: None,
        version: None,
        detail: "Requires an Apple Silicon Mac with macOS 26+, Apple Intelligence enabled, and an alter build containing the Apple model helper.".into(),
        inference: "on-device".into(),
    };
    #[cfg(apple_foundation_available)]
    {
        match tokio::time::timeout(std::time::Duration::from_secs(10), run_helper(None)).await {
            Ok(Ok(output)) => match serde_json::from_str::<Value>(output.trim()) {
                Ok(status) => {
                    info.available = status["available"].as_bool().unwrap_or(false);
                    info.detail = if info.available {
                        let window = status["context_window"].as_u64().unwrap_or(4096);
                        format!("Ready on this Mac. Requests stay on device; {window}-token context window.")
                    } else {
                        status["reason"]
                            .as_str()
                            .unwrap_or("Apple Intelligence is unavailable.")
                            .to_string()
                    };
                }
                Err(_) => {
                    info.detail =
                        "Apple's model helper returned an invalid availability response.".into()
                }
            },
            Ok(Err(error)) => info.detail = error.to_string(),
            Err(_) => {
                info.detail = "Checking Apple Intelligence timed out. Try scanning again.".into()
            }
        }
    }
    // Keep the same return structure on platforms where the helper is absent.
    #[cfg(not(apple_foundation_available))]
    {
        info.available = false;
    }
    info
}

pub async fn stream(
    messages: &[Value],
    context: &str,
    tx: mpsc::Sender<Result<Bytes, Infallible>>,
) -> anyhow::Result<()> {
    #[cfg(apple_foundation_available)]
    {
        let instructions = messages
            .first()
            .filter(|message| message["role"] == "system")
            .and_then(|message| message["content"].as_str())
            .unwrap_or("");
        let conversation: Vec<_> = messages
            .iter()
            .filter(|message| message["role"] != "system")
            .collect();
        let request = json!({
            "instructions": instructions,
            "context": context,
            "prompt": format!("Analyze the following conversation. Respond to the latest user message.\n{}", serde_json::to_string(&conversation)?),
            "max_response_tokens": 1024,
        });
        let output = run_helper(Some(serde_json::to_vec(&request)?)).await?;
        forward_response(&output, &tx).await
    }
    #[cfg(not(apple_foundation_available))]
    {
        let _ = (messages, context, tx);
        anyhow::bail!("Apple Foundation Models is unavailable in this build. Use an Apple Silicon Mac with macOS 26+ and build alter with Xcode 26 or later.")
    }
}

#[cfg(any(apple_foundation_available, test))]
async fn forward_response(
    output: &str,
    tx: &mpsc::Sender<Result<Bytes, Infallible>>,
) -> anyhow::Result<()> {
    let mut received_text = false;
    let mut completed = false;
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let event: Value = serde_json::from_str(line)
            .map_err(|_| anyhow::anyhow!("Apple's model helper returned an invalid response."))?;
        if let Some(error) = event["error"].as_str() {
            anyhow::bail!("{error}")
        }
        if let Some(delta) = event["delta"].as_str().filter(|text| !text.is_empty()) {
            received_text = true;
            tx.send(Ok(Bytes::from(format!(
                "data: {}\n\n",
                json!({ "delta": delta })
            ))))
            .await
            .map_err(|_| anyhow::anyhow!("Chat closed"))?;
        }
        completed |= event["done"].as_bool().unwrap_or(false);
    }
    anyhow::ensure!(
        completed && received_text,
        "Apple's on-device model returned no complete response. Try a shorter request."
    );
    Ok(())
}

#[cfg(apple_foundation_available)]
async fn run_helper(request: Option<Vec<u8>>) -> anyhow::Result<String> {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Stdio;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // A binary linked against macOS 26 can be rejected by dyld before Swift's
    // availability guard runs, so report that requirement before launching it.
    if let Ok(version) = tokio::process::Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .kill_on_drop(true)
        .output()
        .await
    {
        if let Some(major) = String::from_utf8_lossy(&version.stdout)
            .trim()
            .split('.')
            .next()
            .and_then(|value| value.parse::<u32>().ok())
        {
            anyhow::ensure!(
                major >= 26,
                "Apple Foundation Models requires macOS 26 or later."
            );
        }
    }

    // A private temporary directory prevents stale or replaced helpers from being run.
    let directory = tempfile::Builder::new()
        .prefix("alter-apple-ai-")
        .tempdir()?;
    let executable = directory.path().join("apple-foundation-helper");
    std::fs::write(
        &executable,
        include_bytes!(concat!(env!("OUT_DIR"), "/apple-foundation-helper")),
    )?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))?;
    let mut command = tokio::process::Command::new(&executable);
    command
        .current_dir(directory.path())
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if request.is_none() {
        command.arg("--availability");
    }
    let mut child = command.spawn().map_err(|error| {
        anyhow::anyhow!("Cannot start Apple's model helper: {error}. macOS 26+ is required.")
    })?;
    let input_result = async {
        if let Some(mut stdin) = child.stdin.take() {
            if let Some(input) = request {
                stdin.write_all(&input).await?;
            }
            stdin.shutdown().await?;
        }
        Ok::<_, std::io::Error>(())
    }
    .await;
    let mut stdout = child.stdout.take().unwrap().take(1_048_577);
    let mut stderr = child.stderr.take().unwrap().take(16_385);
    let mut output = Vec::new();
    let mut errors = Vec::new();
    let (_, _, status) = tokio::try_join!(
        stdout.read_to_end(&mut output),
        stderr.read_to_end(&mut errors),
        child.wait()
    )?;
    anyhow::ensure!(
        output.len() <= 1_048_576 && errors.len() <= 16_384,
        "Apple's model helper exceeded its output limit."
    );
    anyhow::ensure!(
        status.success(),
        "Apple's model helper failed: {}",
        String::from_utf8_lossy(&errors).trim()
    );
    preserve_helper_error(String::from_utf8(output)?, input_result)
}

#[cfg(any(apple_foundation_available, test))]
fn preserve_helper_error(
    output: String,
    input_result: std::io::Result<()>,
) -> anyhow::Result<String> {
    // A helper can reject a request and exit before its input pipe is drained.
    // Keep its useful diagnostic instead of replacing it with Broken pipe.
    let reported_error = output.lines().any(|line| {
        serde_json::from_str::<Value>(line)
            .ok()
            .is_some_and(|event| event["error"].is_string())
    });
    if !reported_error {
        input_result?;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn response_preserves_unicode_and_propagates_model_errors() {
        let (tx, mut rx) = mpsc::channel(2);
        forward_response("{\"delta\":\"नमस्ते\"}\n{\"done\":true}\n", &tx)
            .await
            .unwrap();
        assert!(
            String::from_utf8(rx.recv().await.unwrap().unwrap().to_vec())
                .unwrap()
                .contains("नमस्ते")
        );
        let error = forward_response("{\"error\":\"Model not ready\"}\n", &tx)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Model not ready"));
    }

    #[tokio::test]
    async fn incomplete_or_invalid_output_is_not_reported_as_success() {
        let (tx, _rx) = mpsc::channel(4);
        for output in ["", "not json", "{\"done\":true}", "{\"delta\":\"partial\"}"] {
            assert!(forward_response(output, &tx).await.is_err());
        }
    }

    #[test]
    fn early_helper_error_survives_a_closed_input_pipe() {
        let broken_pipe = || Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe));
        let output = "{\"error\":\"Enable Apple Intelligence\"}\n".to_string();
        assert_eq!(
            preserve_helper_error(output.clone(), broken_pipe()).unwrap(),
            output
        );
        assert!(preserve_helper_error(String::new(), broken_pipe()).is_err());
    }
}
