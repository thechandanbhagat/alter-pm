# alter — PowerShell installer
#
#   irm https://raw.githubusercontent.com/thechandanbhagat/alter-pm/main/scripts/install.ps1 | iex
#
# Downloads the latest Windows x64 installer from GitHub Releases and runs it
# silently. Does not need an elevated shell: the installer itself requests
# elevation, so you get one UAC prompt.
#
# Environment overrides:
#   ALTER_VERSION  install a specific version instead of the latest, e.g. '1.3.2'

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Invoke-WebRequest is ~10x slower without this

$Repo    = 'thechandanbhagat/alter-pm'
$Headers = @{ 'User-Agent' = 'alter-install' }

function Write-Step($msg) { Write-Host "[alter] $msg" }
function Fail($msg) { Write-Host "[alter] $msg" -ForegroundColor Red; exit 1 }

# ── Preflight ────────────────────────────────────────────────────────────────
if (-not ($IsWindows -or $env:OS -eq 'Windows_NT')) {
    Fail 'this installer is for Windows. On Linux use the .deb from the releases page.'
}

# PROCESSOR_ARCHITECTURE reports x86 for a 32-bit shell on 64-bit Windows;
# PROCESSOR_ARCHITEW6432 is the real architecture in that case.
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64') {
    Fail "alter publishes x64 builds only (this machine reports $arch). Build from source instead."
}

# ── Resolve the release ──────────────────────────────────────────────────────
if ($env:ALTER_VERSION) {
    $tag = 'v' + $env:ALTER_VERSION.TrimStart('v')
    $api = "https://api.github.com/repos/$Repo/releases/tags/$tag"
    Write-Step "resolving $tag..."
} else {
    $api = "https://api.github.com/repos/$Repo/releases/latest"
    Write-Step 'resolving latest release...'
}

try {
    $release = Invoke-RestMethod $api -Headers $Headers
} catch {
    Fail "could not reach GitHub: $($_.Exception.Message)"
}

$version = $release.tag_name.TrimStart('v')
$name    = "alter-$version-windows-x64-setup.exe"
$asset   = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
if (-not $asset) {
    Fail "release $($release.tag_name) has no asset named $name"
}

# ── Back up the machine PATH ─────────────────────────────────────────────────
# Cheap insurance. Releases up to 1.3.1 truncated the machine PATH at 1024
# characters during install (issue #11); this keeps a copy either way.
$backup = Join-Path $env:USERPROFILE ('alter-path-backup-{0}.txt' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
try {
    [Environment]::GetEnvironmentVariable('Path', 'Machine') | Set-Content $backup -Encoding UTF8
    Write-Step "machine PATH backed up to $backup"
} catch {
    Write-Step "could not back up PATH: $($_.Exception.Message)"
}

# ── Stop a running daemon ────────────────────────────────────────────────────
# Otherwise the installer has to close the running alter.exe via Restart Manager
# to replace it, which kills it without saving state.
if (Get-Command alter -ErrorAction SilentlyContinue) {
    Write-Step 'stopping running daemon...'
    try { alter daemon stop *>$null } catch { }
}

# ── Download ─────────────────────────────────────────────────────────────────
$exe = Join-Path $env:TEMP $name
Write-Step "downloading $name..."
try {
    Invoke-WebRequest $asset.browser_download_url -OutFile $exe -Headers $Headers
} catch {
    Fail "download failed: $($_.Exception.Message)"
}

# ── Install ──────────────────────────────────────────────────────────────────
# Same switches as the winget manifest, so this matches `winget install`.
# -Verb RunAs raises the UAC prompt; it cannot be combined with -NoNewWindow.
Write-Step 'installing (approve the UAC prompt)...'
try {
    $proc = Start-Process -FilePath $exe `
        -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' `
        -Verb RunAs -Wait -PassThru
} catch {
    Remove-Item $exe -Force -ErrorAction SilentlyContinue
    Fail "could not launch the installer (UAC declined?): $($_.Exception.Message)"
}

Remove-Item $exe -Force -ErrorAction SilentlyContinue

if ($proc.ExitCode -ne 0) {
    Fail "installer exited with code $($proc.ExitCode)"
}

Write-Host "[alter] installed $version" -ForegroundColor Green
Write-Host '[alter] open a new terminal, then run: alter --help'
