param(
  [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$composeFile = Join-Path $repositoryRoot "deploy\compose\docker-compose.yml"
$envFile = Join-Path $repositoryRoot "deploy\compose\.env"
$logDirectory = Join-Path $env:LOCALAPPDATA "BareMetalJacket"
$logFile = Join-Path $logDirectory "foundation-startup.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Start-Transcript -Path $logFile -Append | Out-Null

try {
  if (-not (Test-Path $envFile)) {
    throw "Missing $envFile. Create it from .env.example before running this script."
  }
  if (-not (Test-Path $dockerDesktop)) {
    throw "Docker Desktop is not installed at $dockerDesktop."
  }

  $env:Path = "$dockerBin;$env:Path"
  docker desktop start --detach

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $status = docker desktop status --format json 2>$null | ConvertFrom-Json
    if ($status.Status -eq "running") {
      break
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  if ($status.Status -ne "running") {
    throw "Docker Desktop did not become ready within $TimeoutSeconds seconds."
  }

  docker compose `
    --env-file $envFile `
    -f $composeFile `
    --profile demo `
    up --detach --build --wait

  Push-Location $repositoryRoot
  try {
    node scripts/deployment-smoke.mjs
  } finally {
    Pop-Location
  }
} finally {
  Stop-Transcript | Out-Null
}
