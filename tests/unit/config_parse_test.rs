// @group UnitTests : TOML/JSON ecosystem config parsing tests

#[cfg(test)]
mod tests {
    use alter::config::ecosystem::{AppConfig, EcosystemConfig};
    use std::io::Write;
    use tempfile::NamedTempFile;

    // @group UnitTests > Config : Parse minimal TOML
    #[test]
    fn test_parse_minimal_toml() {
        let toml = r#"
[[apps]]
name   = "my-app"
script = "python"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.apps.len(), 1);
        assert_eq!(config.apps[0].name, "my-app");
        assert_eq!(config.apps[0].script, "python");
        assert!(config.apps[0].autorestart); // default true
        assert_eq!(config.apps[0].max_restarts, 10); // default 10
    }

    // @group UnitTests > Config : Parse full TOML with env vars
    #[test]
    fn test_parse_full_toml_with_env() {
        let toml = r#"
[[apps]]
name             = "api"
script           = "node"
args             = ["server.js", "--port", "3000"]
autorestart      = false
max_restarts     = 3
restart_delay_ms = 500

[apps.env]
NODE_ENV = "production"
PORT     = "3000"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.args, vec!["server.js", "--port", "3000"]);
        assert!(!app.autorestart);
        assert_eq!(app.max_restarts, 3);
        assert_eq!(app.env.get("NODE_ENV"), Some(&"production".to_string()));
        assert_eq!(app.env.get("PORT"), Some(&"3000".to_string()));
    }

    // @group UnitTests > Config : Parse JSON config
    #[test]
    fn test_parse_json_config() {
        let json = r#"{"apps": [{"name": "app", "script": "go", "args": ["run", "main.go"]}]}"#;
        let config: EcosystemConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.apps[0].script, "go");
    }

    // @group EdgeCases : Missing required fields should fail
    #[test]
    fn test_missing_name_fails() {
        let toml = r#"
[[apps]]
script = "python"
"#;
        let result: Result<EcosystemConfig, _> = toml::from_str(toml);
        assert!(result.is_err());
    }

    // @group UnitTests > Config : Health check fields parsed from TOML
    #[test]
    fn test_health_check_fields_toml() {
        let toml = r#"
[[apps]]
name                    = "web"
script                  = "node"
health_check_url        = "http://localhost:3000/health"
health_check_interval_secs = 15
health_check_timeout_secs  = 3
health_check_retries       = 5
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.health_check_url.as_deref(), Some("http://localhost:3000/health"));
        assert_eq!(app.health_check_interval_secs, 15);
        assert_eq!(app.health_check_timeout_secs, 3);
        assert_eq!(app.health_check_retries, 5);
    }

    // @group UnitTests > Config : Health check defaults when not specified
    #[test]
    fn test_health_check_defaults() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.health_check_url, None);
        assert_eq!(app.health_check_interval_secs, 30); // default
        assert_eq!(app.health_check_timeout_secs, 5);   // default
        assert_eq!(app.health_check_retries, 3);         // default
    }

    // @group UnitTests > Config : Lifecycle hooks parsed from TOML
    #[test]
    fn test_lifecycle_hooks_toml() {
        let toml = r#"
[[apps]]
name       = "api"
script     = "node"
pre_start  = "echo before start"
post_start = "curl http://localhost/warmup"
pre_stop   = "curl -X POST http://localhost/drain"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.pre_start.as_deref(), Some("echo before start"));
        assert_eq!(app.post_start.as_deref(), Some("curl http://localhost/warmup"));
        assert_eq!(app.pre_stop.as_deref(), Some("curl -X POST http://localhost/drain"));
    }

    // @group UnitTests > Config : Hooks default to None when absent
    #[test]
    fn test_lifecycle_hooks_default_none() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        let app = &config.apps[0];
        assert!(app.pre_start.is_none());
        assert!(app.post_start.is_none());
        assert!(app.pre_stop.is_none());
    }

    // @group UnitTests > Config : Instances field for cluster mode
    #[test]
    fn test_instances_field_toml() {
        let toml = r#"
[[apps]]
name      = "worker"
script    = "node"
instances = 4
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.apps[0].instances, 4);
    }

    // @group UnitTests > Config : Instances defaults to 1
    #[test]
    fn test_instances_defaults_to_one() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.apps[0].instances, 1);
    }

    // @group UnitTests > Config : TCP health check URL (host:port format)
    #[test]
    fn test_tcp_health_check_url() {
        let toml = r#"
[[apps]]
name             = "db-proxy"
script           = "proxy"
health_check_url = "localhost:5432"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.apps[0].health_check_url.as_deref(), Some("localhost:5432"));
    }

    // @group UnitTests > Config : All advanced fields in JSON
    #[test]
    fn test_advanced_fields_json() {
        let json = r#"{
            "apps": [{
                "name": "api",
                "script": "node",
                "instances": 2,
                "health_check_url": "http://localhost:8080/health",
                "health_check_interval_secs": 20,
                "health_check_timeout_secs": 4,
                "health_check_retries": 2,
                "pre_start": "npm run db:migrate",
                "post_start": "echo started",
                "pre_stop": "npm run flush"
            }]
        }"#;
        let config: EcosystemConfig = serde_json::from_str(json).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.instances, 2);
        assert_eq!(app.health_check_url.as_deref(), Some("http://localhost:8080/health"));
        assert_eq!(app.health_check_interval_secs, 20);
        assert_eq!(app.health_check_timeout_secs, 4);
        assert_eq!(app.health_check_retries, 2);
        assert_eq!(app.pre_start.as_deref(), Some("npm run db:migrate"));
        assert_eq!(app.post_start.as_deref(), Some("echo started"));
        assert_eq!(app.pre_stop.as_deref(), Some("npm run flush"));
    }

    // @group UnitTests > Config : enabled flag defaults to true
    #[test]
    fn test_enabled_defaults_true() {
        let toml = r#"
[[apps]]
name   = "api"
script = "node"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert!(config.apps[0].enabled);
    }

    // @group UnitTests > Config : enabled flag can be set to false
    #[test]
    fn test_enabled_false() {
        let toml = r#"
[[apps]]
name    = "api"
script  = "node"
enabled = false
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert!(!config.apps[0].enabled);
    }

    // @group UnitTests > Config : Multiple apps with mixed advanced config
    #[test]
    fn test_multiple_apps_mixed_config() {
        let toml = r#"
[[apps]]
name             = "api"
script           = "node"
instances        = 3
health_check_url = "http://localhost:3000/health"

[[apps]]
name   = "worker"
script = "node"
"#;
        let config: EcosystemConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.apps.len(), 2);
        assert_eq!(config.apps[0].instances, 3);
        assert!(config.apps[0].health_check_url.is_some());
        assert_eq!(config.apps[1].instances, 1);  // default
        assert!(config.apps[1].health_check_url.is_none());
    }

    // @group UnitTests > Config : Config file round-trip through temp file
    #[test]
    fn test_config_file_toml_roundtrip() {
        let toml = r#"
[[apps]]
name             = "my-service"
script           = "python"
instances        = 2
health_check_url = "http://localhost:8000/ping"
pre_start        = "python migrate.py"
"#;
        let mut tmpfile = NamedTempFile::with_suffix(".toml").unwrap();
        tmpfile.write_all(toml.as_bytes()).unwrap();
        let config = EcosystemConfig::from_file(tmpfile.path()).unwrap();
        let app = &config.apps[0];
        assert_eq!(app.name, "my-service");
        assert_eq!(app.instances, 2);
        assert_eq!(app.health_check_url.as_deref(), Some("http://localhost:8000/ping"));
        assert_eq!(app.pre_start.as_deref(), Some("python migrate.py"));
    }
}
