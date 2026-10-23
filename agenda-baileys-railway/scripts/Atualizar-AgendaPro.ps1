# Agenda Pro - atualizacao automatica e isolada do Docker Desktop no Windows
# Fonte: branch de implantacao explicitamente aprovada. Nunca edita .env nem volume de sessoes.
param([switch]$Force)
$ErrorActionPreference = "Stop"
$repo = "grafficaatos-coder/pagamente"
$release = "deploy/agenda-pro-docker"
$stateDir = Join-Path $env:LOCALAPPDATA "AgendaProDocker"
$lastFile = Join-Path $stateDir "versao-instalada.txt"
$logFile = Join-Path $stateDir "atualizacoes.log"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Log([string]$message) {
  $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " - " + $message
  Add-Content -LiteralPath $logFile -Value $line
  Write-Host $line
}
function RunDocker([string[]]$ArgsList) {
  # In Windows PowerShell 5.1, & (Get-Command docker).Source can bind
  # multiple native command paths into a single invalid command name.
  # Resolve EXACTLY one docker.exe path, then invoke its executable.
  $command = Get-Command docker.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if (-not $command) { throw "docker.exe nao encontrado no PATH" }
  $exe = [string]$command.Source
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "Executavel Docker invalido: $exe"
  }
  & $exe @ArgsList
  if ($LASTEXITCODE -ne 0) { throw "Docker retornou erro ao executar: $($ArgsList[0]); codigo $LASTEXITCODE" }
}
$mutex = New-Object System.Threading.Mutex($false, "Local\AgendaProDockerAutoUpdate")
$locked = $false
$tempDir = $null
$restore = $false
$oldImage = $null
$project = $null
$workDir = $null
$oldVolume = $null
$backupDir = $null
try {
  $locked = $mutex.WaitOne(0)
  if (-not $locked) { Log "Atualizacao ja em andamento, ignorando execucao duplicada."; return }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    if (Test-Path $dockerExe) { $env:PATH = (Split-Path $dockerExe) + ";" + $env:PATH }
  }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker nao foi localizado" }
  $container = @((docker inspect agenda-pro-whatsapp | ConvertFrom-Json))[0]
  if (-not $container -or $LASTEXITCODE -ne 0) { throw "Container agenda-pro-whatsapp nao encontrado" }
  if (-not $container.State.Running) { throw "Docker esta desligado. Atualizacao cancelada." }
  $labels = $container.Config.Labels
  $project = [string]$labels.'com.docker.compose.project'
  $workDir = [string]$labels.'com.docker.compose.project.working_dir'
  if ([string]::IsNullOrWhiteSpace($project) -or [string]::IsNullOrWhiteSpace($workDir)) {
    throw "Projeto Docker Compose nao identificado"
  }
  $workDir = (Resolve-Path -LiteralPath $workDir).Path
  if (-not (Test-Path -LiteralPath (Join-Path $workDir ".env"))) {
    throw "Arquivo .env original nao encontrado; nenhuma alteracao realizada"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $workDir "compose.yaml"))) {
    throw "compose.yaml original nao encontrado; nenhuma alteracao realizada"
  }
  $dataMount = @($container.Mounts | Where-Object { $_.Destination -eq "/data" }) | Select-Object -First 1
  if (-not $dataMount -or $dataMount.Type -ne "volume" -or -not $dataMount.Name) {
    throw "Volume persistente de sessoes nao identificado, bloqueando atualizacao"
  }
  $oldVolume = [string]$dataMount.Name
  $oldImage = [string]$container.Image
  $url = "https://api.github.com/repos/$repo/commits/deploy%2Fagenda-pro-docker"
  $meta = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent"="AgendaProDockerAutoUpdater"; Accept="application/vnd.github+json" } -TimeoutSec 30
  $sha = [string]$meta.sha
  if ($sha -notmatch "^[a-f0-9]{40}$") { throw "GitHub retornou versao invalida" }
  $installed = if (Test-Path $lastFile) { (Get-Content $lastFile -Raw).Trim() } else { "" }
  if (-not $Force -and $installed -eq $sha) { return }
  Log "Nova versao aprovada detectada: $($sha.Substring(0,10))"
  $tempDir = Join-Path $env:TEMP ("agenda-autoupdate-"+[guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  $zip = Join-Path $tempDir "codigo.zip"
  Invoke-WebRequest -Uri "https://codeload.github.com/$repo/zip/$sha" -OutFile $zip -TimeoutSec 120 -UseBasicParsing
  $unzip = Join-Path $tempDir "descompactado"
  Expand-Archive -LiteralPath $zip -DestinationPath $unzip -Force
  $stage = Get-ChildItem -Path $unzip -Directory -Recurse -Filter "agenda-baileys-railway" |
    Where-Object { (Test-Path (Join-Path $_.FullName "Dockerfile")) -and (Test-Path (Join-Path $_.FullName "compose.yaml")) } |
    Select-Object -First 1
  if (-not $stage) { throw "Codigo do Docker nao localizado no release" }
  $stagePath = $stage.FullName
  $composeText = Get-Content (Join-Path $stagePath "compose.yaml") -Raw
  if ($composeText -notmatch 'DISPATCH_ENABLED:\s*["'']false["'']' -or
      $composeText -notmatch 'ALLOW_ALL_BUSINESSES:\s*["'']false["'']' -or
      $composeText -notmatch 'TEST_AUTO_DISPATCH_ENABLED:') {
    throw "Bloqueio: esta versao nao preserva a seguranca dos envios"
  }
  $tag = "agenda-pro-whatsapp:teste-"+$sha.Substring(0,12)
  RunDocker -ArgsList @("build","--tag",$tag,"--file",(Join-Path $stagePath "Dockerfile"),$stagePath)
  $now = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $stateDir ("backup-codigo-"+$now)
  New-Item -ItemType Directory -Path $backupDir | Out-Null
  $codeFiles = @("server.mjs","auth-state.mjs","local-poll-bridge.mjs","Dockerfile","package.json","package-lock.json","compose.yaml",".dockerignore")
  foreach ($file in $codeFiles) {
    $existing = Join-Path $workDir $file
    if (Test-Path -LiteralPath $existing) {
      Copy-Item -LiteralPath $existing -Destination (Join-Path $backupDir $file) -Force
    }
  }
  $restore = $true
  foreach ($file in $codeFiles) {
    $updated = Join-Path $stagePath $file
    if (Test-Path -LiteralPath $updated) {
      Copy-Item -LiteralPath $updated -Destination (Join-Path $workDir $file) -Force
    }
  }
  RunDocker -ArgsList @("tag",$tag,"agenda-pro-whatsapp:local")
  RunDocker -ArgsList @("compose","--project-name",$project,"--project-directory",$workDir,"--file",(Join-Path $workDir "compose.yaml"),"up","-d","--no-build","--force-recreate")
  $ready = $false
  for ($i=0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/ready" -TimeoutSec 3
      if ($health.ok -eq $true -and $health.database_ready -eq $true -and $health.dispatch_enabled -eq $false) {
        $ready = $true
        break
      }
    } catch { }
  }
  if (-not $ready) { throw "Nova versao nao ficou pronta; iniciando retorno automatico" }
  $newContainer = @((docker inspect agenda-pro-whatsapp | ConvertFrom-Json))[0]
  $newVolume = @($newContainer.Mounts | Where-Object { $_.Destination -eq "/data" }) | Select-Object -First 1
  if (-not $newVolume -or [string]$newVolume.Name -ne $oldVolume) {
    throw "Volume de sessoes alterado! Iniciando retorno automatico"
  }
  Set-Content -LiteralPath $lastFile -Value $sha -NoNewline
  $restore = $false
  Log "Versao atualizada com sucesso. Volume preservado; envios automaticos gerais desligados."
} catch {
  Log ("Falha: "+$_.Exception.Message)
  if ($restore -and $oldImage -and $workDir -and $backupDir) {
    try {
      $files = Get-ChildItem -LiteralPath $backupDir -File
      foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $workDir $file.Name) -Force }
      RunDocker -ArgsList @("tag",$oldImage,"agenda-pro-whatsapp:local")
      RunDocker -ArgsList @("compose","--project-name",$project,"--project-directory",$workDir,"--file",(Join-Path $workDir "compose.yaml"),"up","-d","--no-build","--force-recreate")
      Log "Versao anterior restaurada. Verifique a saude do Docker."
    } catch { Log ("Falha ao restaurar; intervencao necessaria: "+$_.Exception.Message) }
  }
  exit 1
} finally {
  if ($tempDir -and (Test-Path -LiteralPath $tempDir)) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
