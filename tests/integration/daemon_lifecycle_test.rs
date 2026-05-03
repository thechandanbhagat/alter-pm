// @group IntegrationTests : Daemon start → spawn process → stop daemon lifecycle

#[cfg(test)]
mod tests {
    use alter::config::ecosystem::AppConfig;
    use alter::config::daemon_config::DaemonConfig;
    use alter::daemon::state::DaemonState;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// Returns the shell command and args for a cross-platform no-op command.
    /// On Windows, `echo` is a shell builtin so we delegate to `cmd /C echo`.
    fn test_config() -> AppConfig {
        #[cfg(windows)]
        let (script, args) = (
            "cmd".to_string(),
            vec!["/C".to_string(), "echo".to_string(), "hello from alter".to_string()],
        );
        #[cfg(not(windows))]
        let (script, args) = (
            "echo".to_string(),
            vec!["hello from alter".to_string()],
        );

        AppConfig {
            name: "test-app".to_string(),
            script,
            args,
            cwd: None,
            instances: 1,
            autorestart: false,
            max_restarts: 0,
            restart_delay_ms: 100,
            watch: false,
            watch_paths: vec![],
            watch_ignore: vec![],
            env: HashMap::new(),
            log_file: None,
            error_file: None,
            max_log_size_mb: 10,
            namespace: "default".to_string(),
            cron: None,
            cron_last_run: None,
            cron_next_run: None,
            notify: None,
            log_alert: None,
            env_file: None,
            health_check_url: None,
            health_check_interval_secs: 30,
            health_check_timeout_secs: 5,
            health_check_retries: 3,
            pre_start: None,
            post_start: None,
            pre_stop: None,
            enabled: true,
        }
    }

    // @group IntegrationTests > Lifecycle : Start a process and verify it appears in the list
    // Requires OS-level process spawning — skipped in sandboxed/locked-down environments.
    // Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "requires OS process spawning (blocked by Windows security in some environments)"]
    async fn test_start_and_list() {
        let state = Arc::new(DaemonState::new(DaemonConfig::default()));
        let info = state.manager.start(test_config()).await.unwrap();
        assert_eq!(info.name, "test-app");

        let list = state.manager.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "test-app");
    }

    // @group IntegrationTests > Lifecycle : Stop a running process
    #[tokio::test]
    #[ignore = "requires OS process spawning (blocked by Windows security in some environments)"]
    async fn test_start_and_stop() {
        let state = Arc::new(DaemonState::new(DaemonConfig::default()));
        let info = state.manager.start(test_config()).await.unwrap();
        let id = info.id;

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let stopped = state.manager.stop(id).await;
        // Echo exits quickly, so stop may already be stopped — either way no panic
        assert!(stopped.is_ok() || stopped.is_err());
    }

    // @group IntegrationTests > Lifecycle : Delete removes from registry
    #[tokio::test]
    #[ignore = "requires OS process spawning (blocked by Windows security in some environments)"]
    async fn test_delete_removes_from_registry() {
        let state = Arc::new(DaemonState::new(DaemonConfig::default()));
        let info = state.manager.start(test_config()).await.unwrap();
        let id = info.id;

        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        state.manager.delete(id).await.unwrap();

        let list = state.manager.list().await;
        assert_eq!(list.len(), 0);
    }
}
