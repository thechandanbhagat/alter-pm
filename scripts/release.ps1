# release.ps1 — Build a release installer for alter
# Usage:  .\scripts\release.ps1 -Version 0.1.0
# Requires: Rust (cargo), Inno Setup 6 installed at default path

param(
    [Parameter(Mandatory)]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root      = Split-Path $PSScriptRoot -Parent
$ISSFile   = Join-Path $Root "installer\alter-setup.iss"
$DistDir   = Join-Path $Root "dist"
$ISCC      = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

Write-Host "==> alter release build v$Version" -ForegroundColor Cyan

# ── 1. Patch version in Inno Setup script ─────────────────────────────────────
Write-Host "--> Patching Inno Setup version..."
$iss = Get-Content $ISSFile -Raw
$iss = $iss -replace '#define AppVersion\s+"[^"]+"', "#define AppVersion  `"$Version`""
Set-Content $ISSFile $iss

# ── 2. Build release binary ───────────────────────────────────────────────────
Write-Host "--> Building release binary (cargo build --release)..."
Push-Location $Root
cargo build --release
Pop-Location

# ── 3. Create installer ───────────────────────────────────────────────────────
Write-Host "--> Building Inno Setup installer..."
if (-not (Test-Path $ISCC)) {
    Write-Error "Inno Setup not found at $ISCC. Install with: choco install innosetup"
}
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
& $ISCC $ISSFile

# ── 4. Compute SHA256 ─────────────────────────────────────────────────────────
$InstallerFile = Get-ChildItem $DistDir -Filter "alter-$Version-*.exe" | Select-Object -First 1
if (-not $InstallerFile) {
    Write-Error "Installer not found in $DistDir"
}
$Hash = (Get-FileHash $InstallerFile.FullName -Algorithm SHA256).Hash.ToLower()

# ── 5. Update WinGet installer manifest ───────────────────────────────────────
Write-Host "--> Updating WinGet manifest SHA256..."
$ManifestDir = Join-Path $Root "winget\manifests\t\thechandanbhagat\alter\$Version"
if (Test-Path $ManifestDir) {
    $InstallerManifest = Join-Path $ManifestDir "thechandanbhagat.alter.installer.yaml"
    $yaml = Get-Content $InstallerManifest -Raw
    $yaml = $yaml -replace 'InstallerSha256: <SHA256_HASH>', "InstallerSha256: $Hash"
    $yaml = $yaml -replace 'InstallerSha256: [a-f0-9]{64}', "InstallerSha256: $Hash"
    Set-Content $InstallerManifest $yaml
    Write-Host "    Manifest updated: $InstallerManifest"
}

# ── 6. Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Release build complete!" -ForegroundColor Green
Write-Host "  Installer : $($InstallerFile.FullName)" -ForegroundColor Green
Write-Host "  SHA256    : $Hash" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Tag the release:  git tag v$Version && git push origin v$Version"
Write-Host "  2. GitHub Actions will create the GitHub Release automatically."
Write-Host "  3. To submit to WinGet, fork https://github.com/microsoft/winget-pkgs"
Write-Host "     and copy winget\manifests\ into the repo, then open a PR."
