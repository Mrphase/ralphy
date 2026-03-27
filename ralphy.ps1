$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	Write-Error "Node.js is required. Install Node.js 18+ and retry."
	exit 1
}

& node (Join-Path $repoRoot "cli\bin.js") @args
exit $LASTEXITCODE
