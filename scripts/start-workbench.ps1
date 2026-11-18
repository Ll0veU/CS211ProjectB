param(
    [string]$Python = 'python',
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    # Build explicitly so the backend and phone receive the same frontend version.
    if (-not (Test-Path -LiteralPath 'frontend\dist\index.html')) {
        throw 'Frontend build missing. Run: cd frontend; npm ci; npm run build'
    }
    & $Python -m backend.server --host $ListenAddress --port $Port
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
