// @group Utilities : Duration, bytes, and uptime formatting helpers

pub fn format_uptime(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else if secs < 86400 {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    } else {
        format!("{}d {}h", secs / 86400, (secs % 86400) / 3600)
    }
}

pub fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes}B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1}KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

pub fn status_color(status: &str) -> &'static str {
    match status {
        "running" | "watching" => "\x1b[32m",  // green
        "stopped"              => "\x1b[33m",  // yellow
        "crashed"              => "\x1b[31m",  // red
        "errored"              => "\x1b[35m",  // magenta
        "starting"             => "\x1b[36m",  // cyan
        "stopping"             => "\x1b[33m",  // yellow
        "sleeping"             => "\x1b[34m",  // blue
        _                      => "\x1b[0m",   // reset
    }
}

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
pub const DIM: &str = "\x1b[2m";

// @group UnitTests : format_uptime / format_bytes / status_color
#[cfg(test)]
mod tests {
    use super::*;

    // @group UnitTests > FormatUptime : Boundary values for every time tier
    #[test]
    fn test_format_uptime_seconds() {
        assert_eq!(format_uptime(0),  "0s");
        assert_eq!(format_uptime(1),  "1s");
        assert_eq!(format_uptime(59), "59s");
    }

    #[test]
    fn test_format_uptime_minutes() {
        assert_eq!(format_uptime(60),   "1m 0s");
        assert_eq!(format_uptime(90),   "1m 30s");
        assert_eq!(format_uptime(3599), "59m 59s");
    }

    #[test]
    fn test_format_uptime_hours() {
        assert_eq!(format_uptime(3600),  "1h 0m");
        assert_eq!(format_uptime(7261),  "2h 1m");
        assert_eq!(format_uptime(86399), "23h 59m");
    }

    #[test]
    fn test_format_uptime_days() {
        assert_eq!(format_uptime(86400),  "1d 0h");
        assert_eq!(format_uptime(90061),  "1d 1h");
        assert_eq!(format_uptime(172800), "2d 0h");
    }

    // @group UnitTests > FormatBytes : Boundary values for B / KB / MB tiers
    #[test]
    fn test_format_bytes_raw() {
        assert_eq!(format_bytes(0),    "0B");
        assert_eq!(format_bytes(1),    "1B");
        assert_eq!(format_bytes(1023), "1023B");
    }

    #[test]
    fn test_format_bytes_kilobytes() {
        assert_eq!(format_bytes(1024),        "1.0KB");
        assert_eq!(format_bytes(1536),        "1.5KB");
        assert_eq!(format_bytes(1024 * 1024 - 1), "1024.0KB");
    }

    #[test]
    fn test_format_bytes_megabytes() {
        assert_eq!(format_bytes(1024 * 1024),     "1.0MB");
        assert_eq!(format_bytes(1024 * 1024 * 2), "2.0MB");
    }

    // @group UnitTests > StatusColor : Every known status maps to the correct ANSI code
    #[test]
    fn test_status_color_known() {
        assert_eq!(status_color("running"),  "\x1b[32m");
        assert_eq!(status_color("watching"), "\x1b[32m");
        assert_eq!(status_color("stopped"),  "\x1b[33m");
        assert_eq!(status_color("crashed"),  "\x1b[31m");
        assert_eq!(status_color("errored"),  "\x1b[35m");
        assert_eq!(status_color("starting"), "\x1b[36m");
        assert_eq!(status_color("stopping"), "\x1b[33m");
        assert_eq!(status_color("sleeping"), "\x1b[34m");
    }

    #[test]
    fn test_status_color_unknown_resets() {
        assert_eq!(status_color("unknown"), "\x1b[0m");
        assert_eq!(status_color(""),        "\x1b[0m");
    }
}
