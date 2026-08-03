# vision-bridge 隐藏启动脚本（用于开机自启 / 手动启动）
$ErrorActionPreference = "Stop"
$node = (Get-Command node).Source
if (-not $node) { throw "未找到 node，请先安装 Node.js" }
Start-Process -FilePath $node -ArgumentList @("$PSScriptRoot\server.mjs") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Write-Output "vision-bridge 已启动（隐藏窗口）"
