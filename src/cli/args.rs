// @group Configuration : CLI argument structures using clap derive macros

use clap::{Args, Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "alter",
    version,
    about = "A fast, cross-platform process manager",
    long_about = None,
)]
pub struct Cli {
    /// Daemon host (default: 127.0.0.1)
    #[arg(long, global = true, default_value = "127.0.0.1", env = "ALTER_HOST")]
    pub host: String,

    /// Daemon port (default: 2999)
    #[arg(long, global = true, default_value = "2999", env = "ALTER_PORT")]
    pub port: u16,

    /// Output raw JSON
    #[arg(long, global = true)]
    pub json: bool,

    /// Suppress ANSI colors
    #[arg(long, global = true)]
    pub no_color: bool,

    /// Internal: run as daemon process (not for direct user use)
    #[arg(long, hide = true)]
    pub internal_daemon: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Start a process or ecosystem config file
    Start(StartArgs),
    /// Stop a running process
    Stop(ProcessRef),
    /// Restart a process
    Restart(ProcessRef),
    /// Delete a process (stop + remove)
    Delete(ProcessRef),
    /// List all processes
    #[command(alias = "ls", alias = "ps")]
    List,
    /// Show detailed info for a process
    Describe(ProcessRef),
    /// Tail logs for a process
    Logs(LogsArgs),
    /// Flush (delete) log files for a process
    Flush(OptionalProcessRef),
    /// Reset restart counter for a process
    Reset(ProcessRef),
    /// Save current process list to disk
    Save,
    /// Restore saved process list
    Resurrect,
    /// Manage the daemon process
    Daemon(DaemonArgs),
    /// Generate OS startup configuration
    Startup,
    /// Remove OS startup configuration
    Unstartup,
    /// Open the web dashboard URL
    Web,
}

#[derive(Args, Debug)]
pub struct StartArgs {
    /// Script/executable to run, or path to ecosystem config file (.toml/.json)
    pub script: String,
    /// Display name for the process
    #[arg(long, short)]
    pub name: Option<String>,
    /// Working directory
    #[arg(long)]
    pub cwd: Option<String>,
    /// Arguments passed to the script (everything after --)
    #[arg(last = true, allow_hyphen_values = true)]
    pub args: Option<Vec<String>>,
    /// Environment variables in KEY=VALUE format
    #[arg(long, short, num_args = 1..)]
    pub env: Option<Vec<String>>,
    /// Enable auto-restart on crash
    #[arg(long, default_value = "true")]
    pub autorestart: bool,
    /// Maximum number of restarts before giving up
    #[arg(long, default_value = "10")]
    pub max_restarts: u32,
    /// Delay in milliseconds before restart attempt
    #[arg(long, default_value = "1000")]
    pub restart_delay_ms: u64,
    /// Watch files for changes and auto-restart
    #[arg(long, short)]
    pub watch: bool,
    /// Paths to watch (requires --watch)
    #[arg(long, num_args = 1..)]
    pub watch_paths: Option<Vec<String>>,
    /// Run on a cron schedule (e.g. "0 * * * *") — process sleeps between runs
    #[arg(long)]
    pub cron: Option<String>,
}

#[derive(Args, Debug)]
pub struct ProcessRef {
    /// Process name, ID, or 'all'
    pub target: String,
}

#[derive(Args, Debug)]
pub struct OptionalProcessRef {
    /// Process name, ID, or 'all' (omit to target all)
    pub target: Option<String>,
}

#[derive(Args, Debug)]
pub struct LogsArgs {
    /// Process name or ID
    pub target: String,
    /// Number of log lines to show
    #[arg(long, short, default_value = "50")]
    pub lines: usize,
    /// Stream new log lines in real-time
    #[arg(long, short)]
    pub follow: bool,
    /// Show only stderr
    #[arg(long, conflicts_with = "out")]
    pub err: bool,
    /// Show only stdout
    #[arg(long, conflicts_with = "err")]
    pub out: bool,
    /// Filter lines to those containing this string (case-insensitive)
    #[arg(long, short = 'g')]
    pub grep: Option<String>,
}

#[derive(Args, Debug)]
pub struct DaemonArgs {
    #[command(subcommand)]
    pub action: DaemonAction,
}

#[derive(Subcommand, Debug)]
pub enum DaemonAction {
    /// Start the daemon in the background
    Start {
        #[arg(long, default_value = "2999", env = "ALTER_PORT")]
        port: u16,
    },
    /// Stop the running daemon (managed processes keep running)
    Stop,
    /// Restart the daemon without stopping managed processes
    Restart,
    /// Check daemon status
    Status,
    /// Tail daemon's own log
    Logs,
}
