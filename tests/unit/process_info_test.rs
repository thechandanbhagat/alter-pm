// @group UnitTests : ProcessInfo serialization — new advanced fields round-trip via JSON

#[cfg(test)]
mod tests {
    use alter::models::process_info::{HealthCheckStatus, ProcessInfo};
    use alter::models::process_status::ProcessStatus;
    use chrono::Utc;
    use std::collections::HashMap;
    use uuid::Uuid;

    // @group TestHelpers : Build a minimal valid ProcessInfo for use in tests
    fn make_process_info() -> ProcessInfo {
        ProcessInfo {
            id: Uuid::new_v4(),
            name: "test-proc".to_string(),
            script: "node".to_string(),
            args: vec![],
            cwd: None,
            status: ProcessStatus::Stopped,
            pid: None,
            restart_count: 0,
            uptime_secs: None,
            last_exit_code: None,
            autorestart: true,
            max_restarts: 10,
            watch: false,
            namespace: "default".to_string(),
            created_at: Utc::now(),
            started_at: None,
            stopped_at: None,
            cron: None,
            cron_next_run: None,
            cron_run_history: vec![],
            cpu_percent: None,
            memory_bytes: None,
            env: HashMap::new(),
            notify: None,
            log_alert: None,
            health_status: None,
            git_branch: None,
            enabled: true,
            instances: 1,
            restart_delay_ms: 1000,
            health_check_url: None,
            health_check_interval_secs: 30,
            health_check_timeout_secs: 5,
            health_check_retries: 3,
            pre_start: None,
            post_start: None,
            pre_stop: None,
        }
    }

    // @group UnitTests > ProcessInfo : Minimal info serializes without error
    #[test]
    fn test_serialize_minimal() {
        let info = make_process_info();
        let result = serde_json::to_string(&info);
        assert!(result.is_ok());
    }

    // @group UnitTests > ProcessInfo : instances field is included in serialized output
    #[test]
    fn test_instances_serialized() {
        let mut info = make_process_info();
        info.instances = 4;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["instances"], 4);
    }

    // @group UnitTests > ProcessInfo : restart_delay_ms serialized correctly
    #[test]
    fn test_restart_delay_ms_serialized() {
        let mut info = make_process_info();
        info.restart_delay_ms = 5000;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["restart_delay_ms"], 5000);
    }

    // @group UnitTests > ProcessInfo : health_check_url None serializes to null
    #[test]
    fn test_health_check_url_null_when_none() {
        let info = make_process_info();
        let json = serde_json::to_value(&info).unwrap();
        assert!(json["health_check_url"].is_null());
    }

    // @group UnitTests > ProcessInfo : health_check_url Some serializes to string
    #[test]
    fn test_health_check_url_serialized() {
        let mut info = make_process_info();
        info.health_check_url = Some("http://localhost:3000/health".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["health_check_url"], "http://localhost:3000/health");
    }

    // @group UnitTests > ProcessInfo : health check numeric fields serialized
    #[test]
    fn test_health_check_numeric_fields_serialized() {
        let mut info = make_process_info();
        info.health_check_interval_secs = 15;
        info.health_check_timeout_secs = 3;
        info.health_check_retries = 5;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["health_check_interval_secs"], 15);
        assert_eq!(json["health_check_timeout_secs"], 3);
        assert_eq!(json["health_check_retries"], 5);
    }

    // @group UnitTests > ProcessInfo : pre_start hook serialized
    #[test]
    fn test_pre_start_serialized() {
        let mut info = make_process_info();
        info.pre_start = Some("npm run migrate".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["pre_start"], "npm run migrate");
    }

    // @group UnitTests > ProcessInfo : post_start hook serialized
    #[test]
    fn test_post_start_serialized() {
        let mut info = make_process_info();
        info.post_start = Some("curl http://localhost/warmup".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["post_start"], "curl http://localhost/warmup");
    }

    // @group UnitTests > ProcessInfo : pre_stop hook serialized
    #[test]
    fn test_pre_stop_serialized() {
        let mut info = make_process_info();
        info.pre_stop = Some("npm run drain".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["pre_stop"], "npm run drain");
    }

    // @group UnitTests > ProcessInfo : None hooks serialize to null
    #[test]
    fn test_hooks_null_when_none() {
        let info = make_process_info();
        let json = serde_json::to_value(&info).unwrap();
        assert!(json["pre_start"].is_null());
        assert!(json["post_start"].is_null());
        assert!(json["pre_stop"].is_null());
    }

    // @group UnitTests > ProcessInfo : All advanced fields together serialize and deserialize
    #[test]
    fn test_advanced_fields_roundtrip() {
        let mut info = make_process_info();
        info.instances = 3;
        info.restart_delay_ms = 2500;
        info.health_check_url = Some("http://localhost:8080/health".to_string());
        info.health_check_interval_secs = 20;
        info.health_check_timeout_secs = 4;
        info.health_check_retries = 2;
        info.pre_start = Some("pre".to_string());
        info.post_start = Some("post".to_string());
        info.pre_stop = Some("stop".to_string());

        let serialized = serde_json::to_string(&info).unwrap();
        let decoded: ProcessInfo = serde_json::from_str(&serialized).unwrap();

        assert_eq!(decoded.instances, 3);
        assert_eq!(decoded.restart_delay_ms, 2500);
        assert_eq!(decoded.health_check_url.as_deref(), Some("http://localhost:8080/health"));
        assert_eq!(decoded.health_check_interval_secs, 20);
        assert_eq!(decoded.health_check_timeout_secs, 4);
        assert_eq!(decoded.health_check_retries, 2);
        assert_eq!(decoded.pre_start.as_deref(), Some("pre"));
        assert_eq!(decoded.post_start.as_deref(), Some("post"));
        assert_eq!(decoded.pre_stop.as_deref(), Some("stop"));
    }

    // @group UnitTests > ProcessInfo : health_status serializes to snake_case
    #[test]
    fn test_health_status_healthy_serialized() {
        let mut info = make_process_info();
        info.health_status = Some(HealthCheckStatus::Healthy);
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["health_status"], "healthy");
    }

    // @group UnitTests > ProcessInfo : health_status unhealthy serialized
    #[test]
    fn test_health_status_unhealthy_serialized() {
        let mut info = make_process_info();
        info.health_status = Some(HealthCheckStatus::Unhealthy);
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["health_status"], "unhealthy");
    }

    // @group UnitTests > ProcessInfo : health_status null when none
    #[test]
    fn test_health_status_null_when_none() {
        let info = make_process_info();
        let json = serde_json::to_value(&info).unwrap();
        assert!(json["health_status"].is_null());
    }

    // @group UnitTests > ProcessInfo : HealthCheckStatus roundtrip
    #[test]
    fn test_health_check_status_roundtrip() {
        let cases = [
            (HealthCheckStatus::Healthy, "\"healthy\""),
            (HealthCheckStatus::Unhealthy, "\"unhealthy\""),
        ];
        for (status, expected_json) in cases {
            let serialized = serde_json::to_string(&status).unwrap();
            assert_eq!(serialized, expected_json);
            let decoded: HealthCheckStatus = serde_json::from_str(&serialized).unwrap();
            assert_eq!(decoded, status);
        }
    }

    // @group UnitTests > ProcessInfo : enabled field defaults — true when set
    #[test]
    fn test_enabled_field_serialized() {
        let mut info = make_process_info();
        info.enabled = false;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["enabled"], false);
    }

    // @group UnitTests > ProcessInfo : status serializes to lowercase
    #[test]
    fn test_status_serializes_lowercase() {
        let mut info = make_process_info();
        info.status = ProcessStatus::Running;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["status"], "running");
    }

    // @group UnitTests > ProcessInfo : running process with pid and uptime
    #[test]
    fn test_running_with_pid_and_uptime() {
        let mut info = make_process_info();
        info.status = ProcessStatus::Running;
        info.pid = Some(1234);
        info.uptime_secs = Some(3600);
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["pid"], 1234);
        assert_eq!(json["uptime_secs"], 3600);
        assert_eq!(json["status"], "running");
    }

    // @group UnitTests > ProcessInfo : env map included in serialized output
    #[test]
    fn test_env_map_serialized() {
        let mut info = make_process_info();
        info.env.insert("NODE_ENV".to_string(), "production".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["env"]["NODE_ENV"], "production");
    }

    // @group UnitTests > ProcessInfo : git_branch serialized when present
    #[test]
    fn test_git_branch_serialized() {
        let mut info = make_process_info();
        info.git_branch = Some("main".to_string());
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["git_branch"], "main");
    }

    // @group EdgeCases > ProcessInfo : large instance count (u32::MAX)
    #[test]
    fn test_large_instance_count() {
        let mut info = make_process_info();
        info.instances = u32::MAX;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["instances"], u32::MAX);
    }

    // @group EdgeCases > ProcessInfo : zero restart_delay_ms is valid
    #[test]
    fn test_zero_restart_delay() {
        let mut info = make_process_info();
        info.restart_delay_ms = 0;
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["restart_delay_ms"], 0);
    }
}
