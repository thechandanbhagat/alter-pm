// @group UnitTests : StartRequest JSON deserialization — all fields including new advanced fields

#[cfg(test)]
mod tests {
    use alter::models::api_types::StartRequest;
    use std::collections::HashMap;

    // @group TestHelpers : Minimal valid JSON for a StartRequest
    fn minimal_json() -> &'static str {
        r#"{"script": "node"}"#
    }

    // @group UnitTests > StartRequest : Minimal JSON deserializes with correct defaults
    #[test]
    fn test_minimal_start_request() {
        let req: StartRequest = serde_json::from_str(minimal_json()).unwrap();
        assert_eq!(req.script, "node");
        assert!(req.name.is_none());
        assert!(req.args.is_none());
        assert!(req.cwd.is_none());
        assert!(req.env.is_none());
        assert!(req.autorestart.is_none());
        assert!(req.max_restarts.is_none());
        assert!(req.instances.is_none());
        assert!(req.health_check_url.is_none());
        assert!(req.pre_start.is_none());
        assert!(req.post_start.is_none());
        assert!(req.pre_stop.is_none());
    }

    // @group UnitTests > StartRequest : Full request with all basic fields
    #[test]
    fn test_full_basic_start_request() {
        let json = r#"{
            "name": "my-api",
            "script": "node",
            "args": ["server.js", "--port", "3000"],
            "cwd": "/app",
            "autorestart": true,
            "max_restarts": 5,
            "restart_delay_ms": 2000,
            "namespace": "production",
            "watch": false
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name.as_deref(), Some("my-api"));
        assert_eq!(req.script, "node");
        assert_eq!(req.args.as_deref().unwrap(), &["server.js", "--port", "3000"]);
        assert_eq!(req.cwd.as_deref(), Some("/app"));
        assert_eq!(req.autorestart, Some(true));
        assert_eq!(req.max_restarts, Some(5));
        assert_eq!(req.restart_delay_ms, Some(2000));
        assert_eq!(req.namespace.as_deref(), Some("production"));
        assert_eq!(req.watch, Some(false));
    }

    // @group UnitTests > StartRequest : instances field deserialized correctly
    #[test]
    fn test_instances_field() {
        let json = r#"{"script": "node", "instances": 4}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.instances, Some(4));
    }

    // @group UnitTests > StartRequest : instances defaults to None when absent
    #[test]
    fn test_instances_absent() {
        let req: StartRequest = serde_json::from_str(minimal_json()).unwrap();
        assert!(req.instances.is_none());
    }

    // @group UnitTests > StartRequest : health_check_url HTTP format
    #[test]
    fn test_health_check_url_http() {
        let json = r#"{"script": "node", "health_check_url": "http://localhost:3000/health"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.health_check_url.as_deref(), Some("http://localhost:3000/health"));
    }

    // @group UnitTests > StartRequest : health_check_url TCP format (host:port)
    #[test]
    fn test_health_check_url_tcp() {
        let json = r#"{"script": "redis-server", "health_check_url": "localhost:6379"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.health_check_url.as_deref(), Some("localhost:6379"));
    }

    // @group UnitTests > StartRequest : health check interval/timeout/retries
    #[test]
    fn test_health_check_numeric_fields() {
        let json = r#"{
            "script": "node",
            "health_check_url": "http://localhost/health",
            "health_check_interval_secs": 20,
            "health_check_timeout_secs": 4,
            "health_check_retries": 2
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.health_check_interval_secs, Some(20));
        assert_eq!(req.health_check_timeout_secs, Some(4));
        assert_eq!(req.health_check_retries, Some(2));
    }

    // @group UnitTests > StartRequest : pre_start hook deserialized
    #[test]
    fn test_pre_start_hook() {
        let json = r#"{"script": "node", "pre_start": "npm run db:migrate"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.pre_start.as_deref(), Some("npm run db:migrate"));
    }

    // @group UnitTests > StartRequest : post_start hook deserialized
    #[test]
    fn test_post_start_hook() {
        let json = r#"{"script": "node", "post_start": "echo app started"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.post_start.as_deref(), Some("echo app started"));
    }

    // @group UnitTests > StartRequest : pre_stop hook deserialized
    #[test]
    fn test_pre_stop_hook() {
        let json = r#"{"script": "node", "pre_stop": "curl -X POST http://localhost/drain"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.pre_stop.as_deref(), Some("curl -X POST http://localhost/drain"));
    }

    // @group UnitTests > StartRequest : all three lifecycle hooks at once
    #[test]
    fn test_all_lifecycle_hooks() {
        let json = r#"{
            "script": "python",
            "pre_start": "python migrate.py",
            "post_start": "curl http://localhost/warmup",
            "pre_stop": "python flush_cache.py"
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.pre_start.as_deref(), Some("python migrate.py"));
        assert_eq!(req.post_start.as_deref(), Some("curl http://localhost/warmup"));
        assert_eq!(req.pre_stop.as_deref(), Some("python flush_cache.py"));
    }

    // @group UnitTests > StartRequest : env map deserialized correctly
    #[test]
    fn test_env_map_deserialized() {
        let json = r#"{
            "script": "node",
            "env": {"NODE_ENV": "production", "PORT": "3000"}
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        let env = req.env.unwrap();
        assert_eq!(env.get("NODE_ENV").map(String::as_str), Some("production"));
        assert_eq!(env.get("PORT").map(String::as_str), Some("3000"));
    }

    // @group UnitTests > StartRequest : cron field deserialized
    #[test]
    fn test_cron_field() {
        let json = r#"{"script": "python", "cron": "0 * * * *"}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.cron.as_deref(), Some("0 * * * *"));
    }

    // @group UnitTests > StartRequest : all new advanced fields together
    #[test]
    fn test_all_advanced_fields_together() {
        let json = r#"{
            "name": "api-cluster",
            "script": "node",
            "args": ["server.js"],
            "instances": 3,
            "health_check_url": "http://localhost:8080/health",
            "health_check_interval_secs": 15,
            "health_check_timeout_secs": 3,
            "health_check_retries": 5,
            "pre_start": "npm run migrate",
            "post_start": "echo ready",
            "pre_stop": "npm run drain"
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.instances, Some(3));
        assert_eq!(req.health_check_url.as_deref(), Some("http://localhost:8080/health"));
        assert_eq!(req.health_check_interval_secs, Some(15));
        assert_eq!(req.health_check_timeout_secs, Some(3));
        assert_eq!(req.health_check_retries, Some(5));
        assert_eq!(req.pre_start.as_deref(), Some("npm run migrate"));
        assert_eq!(req.post_start.as_deref(), Some("echo ready"));
        assert_eq!(req.pre_stop.as_deref(), Some("npm run drain"));
    }

    // @group UnitTests > StartRequest : watch_paths and watch_ignore arrays
    #[test]
    fn test_watch_paths_and_ignore() {
        let json = r#"{
            "script": "node",
            "watch": true,
            "watch_paths": ["src", "config"],
            "watch_ignore": ["node_modules", "*.log"]
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.watch, Some(true));
        let paths = req.watch_paths.unwrap();
        assert_eq!(paths, vec!["src", "config"]);
        let ignore = req.watch_ignore.unwrap();
        assert_eq!(ignore, vec!["node_modules", "*.log"]);
    }

    // @group UnitTests > StartRequest : unknown fields are ignored (no strict mode)
    #[test]
    fn test_unknown_fields_ignored() {
        let json = r#"{"script": "node", "unknown_field": "value", "another": 123}"#;
        let result: Result<StartRequest, _> = serde_json::from_str(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().script, "node");
    }

    // @group UnitTests > StartRequest : script field is required
    #[test]
    fn test_missing_script_fails() {
        let json = r#"{"name": "app"}"#;
        let result: Result<StartRequest, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    // @group UnitTests > StartRequest : instances value of 1 is valid
    #[test]
    fn test_instances_one_is_valid() {
        let json = r#"{"script": "node", "instances": 1}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.instances, Some(1));
    }

    // @group EdgeCases > StartRequest : instances of 0 is accepted (edge case)
    #[test]
    fn test_instances_zero_accepted() {
        let json = r#"{"script": "node", "instances": 0}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.instances, Some(0));
    }

    // @group EdgeCases > StartRequest : health check url can be empty string
    #[test]
    fn test_health_check_url_empty_string() {
        let json = r#"{"script": "node", "health_check_url": ""}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.health_check_url.as_deref(), Some(""));
    }

    // @group UnitTests > StartRequest : max_log_size_mb field
    #[test]
    fn test_max_log_size_mb() {
        let json = r#"{"script": "node", "max_log_size_mb": 50}"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.max_log_size_mb, Some(50));
    }

    // @group UnitTests > StartRequest : serialize/deserialize roundtrip preserves all fields
    #[test]
    fn test_serde_roundtrip() {
        let json = r#"{
            "name": "roundtrip-app",
            "script": "python",
            "args": ["app.py"],
            "instances": 2,
            "health_check_url": "http://localhost/health",
            "health_check_interval_secs": 10,
            "health_check_timeout_secs": 2,
            "health_check_retries": 4,
            "pre_start": "pre",
            "post_start": "post",
            "pre_stop": "stop"
        }"#;
        let req: StartRequest = serde_json::from_str(json).unwrap();
        let serialized = serde_json::to_string(&req).unwrap();
        let req2: StartRequest = serde_json::from_str(&serialized).unwrap();

        assert_eq!(req.name, req2.name);
        assert_eq!(req.script, req2.script);
        assert_eq!(req.instances, req2.instances);
        assert_eq!(req.health_check_url, req2.health_check_url);
        assert_eq!(req.health_check_interval_secs, req2.health_check_interval_secs);
        assert_eq!(req.pre_start, req2.pre_start);
        assert_eq!(req.post_start, req2.post_start);
        assert_eq!(req.pre_stop, req2.pre_stop);
    }
}
