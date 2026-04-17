$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	Write-Error "Node.js is required. Install Node.js 18+ and retry."
	exit 1
}

function Format-InvocationArg {
	param([string]$Value)

	if ($Value -match '[\s"]') {
		return '"' + $Value.Replace('"', '\"') + '"'
	}

	return $Value
}

$scriptPath = [System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
$invocationParts = @($scriptPath) + ($args | ForEach-Object { Format-InvocationArg $_ })
$env:RALPHY_INVOCATION = [string]::Join(" ", $invocationParts)

& node (Join-Path $repoRoot "cli\bin.js") @args
exit $LASTEXITCODE
