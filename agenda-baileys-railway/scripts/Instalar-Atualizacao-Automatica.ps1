# Agenda Pro - instala o atualizador uma unica vez, sem ZIPs.
# Precisa executar na mesma conta do Windows que usa o Docker Desktop.
$ErrorActionPreference="Stop"
$repo="grafficaatos-coder/pagamente"
$root="https://raw.githubusercontent.com/$repo/deploy/agenda-pro-docker/agenda-baileys-railway/scripts"
$state=Join-Path $env:LOCALAPPDATA "AgendaProDocker"
New-Item -ItemType Directory -Path $state -Force | Out-Null
Write-Host "Agenda Pro - instalando atualizacoes automaticas (versoes aprovadas)" -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  $dockerExe=Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
  if(Test-Path $dockerExe){$env:PATH=(Split-Path $dockerExe)+";"+$env:PATH}
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {throw "Abra o Docker Desktop e tente novamente (docker nao encontrado)"}
$container=@((docker inspect agenda-pro-whatsapp | ConvertFrom-Json))[0]
if (-not $container -or $LASTEXITCODE -ne 0 -or -not $container.State.Running) {
  throw "O container agenda-pro-whatsapp precisa estar executando"
}
$workDir=[string]$container.Config.Labels.'com.docker.compose.project.working_dir'
if(-not $workDir -or -not (Test-Path (Join-Path $workDir ".env"))){
  throw "Pasta de instalacao do Docker ou arquivo .env nao localizado"
}
$volume=@($container.Mounts | Where-Object {$_.Destination -eq "/data"}) | Select-Object -First 1
if(-not $volume -or $volume.Type -ne "volume"){
  throw "Volume persistente do WhatsApp nao identificado. Instalacao interrompida."
}
$scriptFile=Join-Path $state "Atualizar-AgendaPro.ps1"
Invoke-WebRequest -Uri ($root+"/Atualizar-AgendaPro.ps1") -OutFile $scriptFile -UseBasicParsing -TimeoutSec 45
if(-not (Test-Path $scriptFile)){throw "Atualizador nao foi baixado"}
# Preserva a versao rodando agora. Apenas uma nova publicacao APROVADA
# no branch deploy/agenda-pro-docker provocara reinstalacao do Docker.
$api="https://api.github.com/repos/$repo/commits/deploy%2Fagenda-pro-docker"
$meta=Invoke-RestMethod -Uri $api -Headers @{"User-Agent"="AgendaProDockerSetup"} -TimeoutSec 40
$sha=[string]$meta.sha
if($sha -notmatch "^[a-f0-9]{40}$"){throw "Versao do GitHub invalida"}
Set-Content -LiteralPath (Join-Path $state "versao-instalada.txt") -Value $sha -NoNewline

$taskName="Agenda Pro - Atualizador Docker"
$exe=Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$action=New-ScheduledTaskAction -Execute $exe -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptFile+'"')
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 365)
$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Instala apenas releases aprovados da Agenda Pro, sem tocar em .env ou volume WhatsApp" -Force | Out-Null
$task=Get-ScheduledTask -TaskName $taskName
if ($task.State -eq "Disabled"){throw "Agendamento desativado. Abra o Agendador de Tarefas."}
Write-Host ""
Write-Host "SUCESSO! Atualizador automatico instalado." -ForegroundColor Green
Write-Host "O Docker atual foi preservado; nao foi reiniciado."
Write-Host "Somente releases aprovados serao instalados; verificacao a cada 10 minutos."
Write-Host "Mantenha o computador ligado e Docker Desktop aberto."
Write-Host ("Registros: "+(Join-Path $state "atualizacoes.log"))
