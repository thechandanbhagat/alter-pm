# Security Report — alter-pm2

> **Classification:** Internal / Developer Use   
> **Assessment Date:** April 14, 2026   
> **Application:** alter-pm2   
> **Version Assessed:** Current (`main` branch)    
> **Assessed By:** Static source code analysis    

---

## Overview

alter-pm2 is a **local developer tool** — a process manager that runs exclusively on the developer's machine, bound to `127.0.0.1:2999`. It is never exposed to the public internet. The web-based dashboard is for local use only.

This report documents the security assessment conducted via static analysis of the Rust/Axum source code. Findings are evaluated against the **correct threat model** for a localhost-only, single-user developer tool.

---

## Threat Model

| Property | Value |
|---|---|
| Network exposure | Loopback only (`127.0.0.1:2999`) |
| Users | Single user (the developer) |
| Multi-tenancy | No |
| Internet-facing | No |
| Attacker access required | Local machine access (which implies full OS-level access anyway) |

Because the application is never reachable from outside the developer's machine, a large class of traditional web application vulnerabilities (remote path traversal, brute force, SSRF, information disclosure to external attackers) simply do not apply.

---

## Assessment Summary

| Metric | Value |
|---|---|
| Initial findings (before threat model applied) | 17 |
| Eliminated — wrong threat model | 14 |
| Eliminated — not app-specific (OS-level risks) | 2 |
| **Genuine findings specific to alter-pm2** | **1** |
| **Overall Risk Rating** | **LOW** |

---

## Genuine Finding

### CSRF via Query Parameter Token Authentication

| Field | Detail |
|---|---|
| **ID** | SEC-001 |
| **Severity** | Low–Medium |
| **OWASP Category** | A01 — Broken Access Control |
| **CWE** | CWE-352 — Cross-Site Request Forgery |
| **File** | `src/api/middleware.rs` |
| **Lines** | 57–75 |
| **Status** | Open |

#### Description

The authentication middleware accepts bearer tokens via query parameter (`?token=`) to support `EventSource`/SSE connections, which cannot set custom HTTP headers. However, this bypass is applied globally across **all** API endpoints — not just SSE routes.

Browsers do not block cross-origin requests to `localhost` by default. This means any website open in the developer's browser can send authenticated requests to `127.0.0.1:2999` if the token is known or guessable.

#### Vulnerable Code

```rust
// src/api/middleware.rs — token extraction
fn extract_token<B>(req: &Request<B>) -> Option<String> {
    // Authorization header (correct)
    if let Some(val) = req.headers().get("Authorization") {
        if let Ok(s) = val.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    // ?token= query param — applies to ALL endpoints (problematic)
    if let Some(query) = req.uri().query() {
        for pair in query.split('&') {
            if let Some(val) = pair.strip_prefix("token=") {
                return Some(val.to_string());
            }
        }
    }
    None
}
```

#### Attack Scenario

1. Developer visits a malicious website while the alter-pm2 web UI is open in another tab
2. The malicious page embeds a request to localhost:
   ```html
   <img src="http://localhost:2999/api/v1/processes/stop-all?token=STOLEN_TOKEN">
   ```
3. The browser sends the request to localhost automatically
4. The developer's managed processes are stopped/started without their knowledge

#### Likelihood & Impact

| | Assessment |
|---|---|
| **Likelihood** | Low — requires visiting a malicious site at exactly the right moment, with the token known |
| **Impact** | Low — attacker can only start/stop/restart local dev processes; no data loss, no credential theft, no system access |

#### Recommended Fix

Restrict `?token=` query parameter authentication to SSE/EventSource endpoints only. All other endpoints must require the `Authorization: Bearer` header.

```rust
// Option A — separate middleware layers
let sse_routes = Router::new()
    .route("/logs/stream", get(sse_handler))
    .route("/processes/:id/logs/stream", get(process_sse_handler))
    .layer(middleware::from_fn_with_state(state.clone(), require_auth_header_or_query));

let api_routes = Router::new()
    .route("/processes", get(list).post(create))
    .route("/processes/:id", delete(remove))
    // ... all other routes
    .layer(middleware::from_fn_with_state(state.clone(), require_auth_header_only));

// Option B — check route path before allowing query token
fn extract_token<B>(req: &Request<B>) -> Option<String> {
    // Always try header first
    if let Some(token) = extract_from_header(req) {
        return Some(token);
    }
    // Only allow ?token= for SSE endpoints
    let path = req.uri().path();
    if path.ends_with("/stream") || path.ends_with("/logs/live") {
        return extract_from_query(req);
    }
    None
}
```

---

## Dismissed Findings

The following were identified in the initial broad audit but confirmed non-issues after applying the correct threat model.

### Dismissed — Wrong Threat Model (Requires Remote Attacker)

| # | Finding | Reason Dismissed |
|---|---|---|
| 1 | Path traversal on env file read/write | No remote attacker can reach the endpoint; developer owns their own filesystem |
| 2 | Arbitrary file browser (`browse_dir`) | Local access only; developer already has full filesystem access |
| 3 | Command injection in system restart endpoint | Only the developer triggers a daemon restart |
| 4 | Missing auth on startup/autostart endpoint | No remote attacker can reach `127.0.0.1` |
| 5 | Brute force on login / PIN endpoints | No remote attacker; only the developer uses the app |
| 6 | Sensitive data exposure in error messages | Only the developer reads error responses |
| 7 | Log injection via process output | Only the developer reads the logs |
| 8 | Script symlink traversal | Developer owns the machine and the scripts directory |
| 9 | CORS misconfiguration | Not relevant without a public deployment |
| 10 | Missing rate limiting on auth endpoints | No remote attacker to perform brute force |
| 11 | Session token cleanup / expiry | Minor operational issue; not exploitable locally |
| 12 | Race condition in rolling restart | Reliability concern, not a security threat |
| 13 | PID reuse in adopt-watcher | Operational edge case; minimal real-world impact |
| 14 | Interpreter extension spoofing in script runner | Developer controls all script content |

### Dismissed — Not Specific to alter-pm2 (OS-Level Risks)

| # | Finding | Reason Dismissed |
|---|---|---|
| 15 | `LD_PRELOAD` injection via user-supplied env vars | Malicious packages run install scripts at `npm install` time — this is an OS/package manager risk, not an alter-pm2 risk |
| 16 | No resource limits on spawned processes | A runaway process freezes the machine whether started by alter-pm2 or a terminal — OS-level concern |

### Dismissed — Valid But Non-Sensitive

| # | Finding | Reason Dismissed |
|---|---|---|
| 17 | Insecure deserialization of `state.json` | `state.json` is equivalent to `ecosystem.config.js` — a local config file with no credentials. If an attacker can write to it, they already have full OS access |

---

## Architecture Security Notes

The following aspects of alter-pm2's architecture are well-implemented from a security perspective:

| Component | Implementation | Assessment |
|---|---|---|
| Password hashing | Argon2id | ✅ Industry standard, correctly used |
| Session tokens | Random tokens, 24h expiry, stored in DashMap | ✅ Appropriate for local tool |
| Memory safety | Rust — no buffer overflows, no use-after-free | ✅ Language-level guarantee |
| Type-safe routing | Axum extractors | ✅ Prevents many injection classes |
| PIN unlock | Argon2id hashed | ✅ Not stored in plaintext |
| Master CLI token | Auto-generated, never expires | ✅ Suitable for local CLI use |
| Telegram bot security | Silently ignores non-whitelisted chat IDs | ✅ Correct approach |
| Daemon binding | `127.0.0.1` only | ✅ Not exposed to network |

---

## Recommendations

### Priority 1 — Fix (Small effort, closes the only real vector)

- [ ] Restrict `?token=` query parameter auth to SSE/EventSource endpoints only (`/logs/stream`, `/processes/:id/logs/stream`)

### Priority 2 — Consider (Nice to have, not urgent)

- [ ] Add `SameSite=Strict` guidance if ever switching to cookie-based sessions
- [ ] Document explicitly in code comments why `?token=` exists and which routes it applies to

### Not Recommended (Unnecessary for local tool)

- ❌ HMAC signing of `state.json` — over-engineering for a local config file
- ❌ Rate limiting on auth endpoints — no remote attacker
- ❌ CORS headers — not publicly exposed
- ❌ Path canonicalization on file browser — developer owns the machine

---

## Conclusion

**alter-pm2 has no significant cybersecurity vulnerabilities for its intended use case.**

The single genuine finding (CSRF via `?token=`) is low severity — an attacker could only manipulate local dev processes with no risk to data, credentials, or the broader system. The fix is a small, targeted code change in `src/api/middleware.rs`.

The application's use of Rust (memory safety), Axum (type-safe routing), and Argon2id (password hashing) reflects sound engineering choices that eliminate entire vulnerability classes at the language and framework level.

---

*Report generated: April 14, 2026*
*Scope: alter-pm2 local process manager — static source code analysis*
*Classification: Internal / Developer Use*
