$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiPort = 8000
$frontendPort = 5173
$openFoamBashrc = "/opt/openfoam13/etc/bashrc"

function Stop-PortProcess {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        return
    }

    foreach ($connection in $connections) {
        if ($connection.OwningProcess -gt 0) {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python launcher 'py' was not found on PATH."
}

Stop-PortProcess -Port $apiPort
Stop-PortProcess -Port $frontendPort

$apiCommand = @"
Set-Location '$repoRoot'
`$env:CFD_WSL_OPENFOAM_BASHRC='$openFoamBashrc'
py -m uvicorn api.app.main:app --reload
"@

$frontendCommand = @"
Set-Location '$repoRoot'
npm.cmd run dev --workspace frontend
"@

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    $apiCommand
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    $frontendCommand
)

Write-Host "Kefka started."
Write-Host "API: http://127.0.0.1:8000"
Write-Host "Frontend: http://localhost:5173"
