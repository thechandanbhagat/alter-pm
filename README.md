# alter — Process Manager

A fast, cross-platform process manager built in Rust. Manages any runtime (Python, Go, Rust, .NET, Node.js, etc.).

## Quick Start

```bash
# Build
cargo build --release

# Start the daemon
./target/release/alter daemon start

# Start a process
alter start python -- -m http.server 8080

# Named process with auto-restart
alter start node -- server.js --name api --autorestart

# Load an ecosystem config
alter start alter.config.toml

# List processes
alter list

# View logs
alter logs api
alter logs api --follow

# Stop / restart / delete
alter stop api
alter restart api
alter delete api

# Save/restore state
alter save
alter resurrect

# Open web dashboard
alter web
# or navigate to: http://127.0.0.1:2999/
```

## Documentation

- [API Reference](./API.md)
- [CLI Reference](./CLI.md)
- [Architecture](./ARCHITECTURE.md)
- [Ecosystem Config](./ECOSYSTEM_CONFIG.md)
- [Changelog](./CHANGELOG.md)
