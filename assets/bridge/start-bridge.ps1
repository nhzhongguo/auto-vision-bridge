# vision-bridge hidden start script
# idempotent: skip if 57399 already listening
$ErrorActionPreference = 'Stop'
$port = 57399
$already = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($already) { Write-Output 'already running, skip'; exit 0 }
$node = (Get-Command node).Source
if (-not $node) { throw 'node not found' }
Start-Process -FilePath $node -ArgumentList @("$PSScriptRoot\server.mjs") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Write-Output 'started'
