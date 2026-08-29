param(
  [string]$BackupRoot = "$HOME\BareMetalJacketBackups\Local"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
$logDirectory = Join-Path $env:LOCALAPPDATA "BareMetalJacket"
$logFile = Join-Path $logDirectory "foundation-backup.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
Start-Transcript -Path $logFile -Append | Out-Null

try {
  $env:Path = "$dockerBin;$env:Path"
  $status = docker desktop status --format json | ConvertFrom-Json
  if ($status.Status -ne "running") {
    throw "Docker Desktop is not running; backup was not attempted."
  }

  Push-Location $repositoryRoot
  try {
    node scripts/backup-foundation.mjs --output $BackupRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Foundation backup failed with exit code $LASTEXITCODE."
    }

    node scripts/verify-foundation-backup.mjs --backup $BackupRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Foundation backup verification failed with exit code $LASTEXITCODE."
    }

    node scripts/deployment-smoke.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "Foundation smoke test failed after backup."
    }
  } finally {
    Pop-Location
  }
} finally {
  Stop-Transcript | Out-Null
}
