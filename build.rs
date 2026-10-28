// @group Configuration : Build script — forward GH_OAUTH_CLIENT_ID to the compiler
//
// Set GH_OAUTH_CLIENT_ID in your environment (or in a .env.build file loaded by your
// build wrapper) before running `cargo build`. The value is baked into the binary
// at compile time via option_env!("GH_OAUTH_CLIENT_ID") in src/api/routes/ai.rs.
//
// Example:
//   GH_OAUTH_CLIENT_ID=Ov23liXXXXXXXXXXXXXX cargo build --release

fn main() {
    build_apple_foundation_helper();

    // @group Configuration : Tauri code-gen — must run before tauri::generate_context!(), and
    // only when the "gui" feature (hence the `tauri` dependency) is actually enabled.
    if std::env::var_os("CARGO_FEATURE_GUI").is_some() {
        tauri_build::build();
    }

    // Re-run this script only when GH_OAUTH_CLIENT_ID changes (not on every build)
    println!("cargo:rerun-if-env-changed=GH_OAUTH_CLIENT_ID");
}

fn build_apple_foundation_helper() {
    println!("cargo:rustc-check-cfg=cfg(apple_foundation_available)");
    println!("cargo:rerun-if-changed=src/ai/apple_foundation.swift");
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    println!("cargo:rerun-if-env-changed=SDKROOT");

    // Other platforms and cross-compiles keep working without an Apple SDK.
    let host = std::env::var("HOST").unwrap_or_default();
    let target = std::env::var("TARGET").unwrap_or_default();
    if host != target || target != "aarch64-apple-darwin" {
        return;
    }
    let out_dir =
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let output = std::process::Command::new("xcrun")
        .arg("swiftc")
        .args([
            "-parse-as-library",
            "-O",
            "-target",
            "arm64-apple-macos26.0",
        ])
        .arg("-module-cache-path")
        .arg(out_dir.join("swift-module-cache"))
        .arg("src/ai/apple_foundation.swift")
        .arg("-o")
        .arg(out_dir.join("apple-foundation-helper"))
        .output();

    match output {
        Ok(output) if output.status.success() => {
            println!("cargo:rustc-cfg=apple_foundation_available");
        }
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr)
                .lines()
                .find(|line| line.contains("error:"))
                .unwrap_or(
                    "Swift compilation failed; install Xcode 26 or later to enable this provider",
                )
                .to_owned();
            println!("cargo:warning=Apple Foundation Models unavailable in this build: {detail}");
        }
        Err(error) => {
            println!("cargo:warning=Apple Foundation Models unavailable in this build: {error}");
        }
    }
}
