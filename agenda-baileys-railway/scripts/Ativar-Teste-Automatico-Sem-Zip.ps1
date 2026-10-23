# Agenda Pro — ativa APENAS o teste automatico preautorizado; sem ZIP.
# Nao cria agendamentos, nao altera clientes Railway e nao habilita DISPATCH_ENABLED.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$id='270de0ad-2013-4afb-b8ba-2e21175b3f01'
$commit='3d84740b4c8e2d217ef25a86dc74b5058855f39f'
$base="https://raw.githubusercontent.com/grafficaatos-coder/pagamente/$commit/agenda-baileys-railway"
$checks=[ordered]@{
  'server.mjs'='e6cbb5844d7d941bc8268f22a29190d106b30c26'
  'local-poll-bridge.mjs'='68923a1ce6477dfa9462003dbfa5986b96c3dce5'
  'compose.yaml'='75f72382799bd5e84b2fab75b725fe346b073f73'
}
function Get-BlobSha([string]$file) {
  $b=[System.IO.File]::ReadAllBytes($file)
  $p=[System.Text.Encoding]::ASCII.GetBytes('blob '+$b.Length+[char]0)
  $sha=[System.Security.Cryptography.SHA1]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([byte[]]($p+$b))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Get-Container {
  $json=(& docker inspect agenda-pro-whatsapp | Out-String)
  if ($LASTEXITCODE -ne 0) {throw 'Docker: contêiner agenda-pro-whatsapp ausente'}
  return @(($json|ConvertFrom-Json))[0]
}
function Get-Env($c,[string]$name) {
  $found=@($c.Config.Env | Where-Object {$_.StartsWith("$name=")} | Select-Object -First 1)
  if ($found.Count -ne 1) {return ''}
  return $found[0].Substring($name.Length+1)
}
if(-not (Get-Command docker -ErrorAction SilentlyContinue)){throw 'Abra o Docker Desktop antes de executar'}
$c=Get-Container
if($c.State.Status -ne 'running'){throw 'Docker está desligado'}
if((Get-Env $c 'DISPATCH_ENABLED') -ne 'false' -or
   (Get-Env $c 'ALLOW_ALL_BUSINESSES') -ne 'false' -or
   (Get-Env $c 'LOCAL_POLL_ENABLED') -ne 'true' -or
   (Get-Env $c 'ALLOWED_BUSINESS_IDS') -ne $id) {throw 'Empresas e bloqueios de segurança não correspondem ao teste técnico'}
$dir=[string]$c.Config.Labels.'com.docker.compose.project.working_dir'
$project=[string]$c.Config.Labels.'com.docker.compose.project'
if(-not $dir -or -not $project -or -not (Test-Path $dir)){throw 'Pasta Docker Compose original não localizada'}
$envFile=Join-Path $dir '.env'
$compose=Join-Path $dir 'compose.yaml'
if(-not (Test-Path $envFile) -or -not (Test-Path $compose)){throw '.env ou compose.yaml original não localizado'}
$mounts=@($c.Mounts|Where-Object {$_.Destination -eq '/data' -and $_.Type -eq 'volume'})
if($mounts.Count -ne 1){throw 'Não foi possível garantir preservação do volume de sessões'}
$volume=[string]$mounts[0].Name
Write-Host 'Agenda Pro: WhatsApp técnico e volume identificados.' -ForegroundColor Cyan
Write-Host 'Este teste pode enviar confirmação e lembrete SOMENTE ao número já autorizado.'
Write-Host 'Envios gerais e empresas Railway permanecem fora do teste.'
$ok=(Read-Host 'Digite SIM para ativar o teste').Trim().ToUpperInvariant()
if($ok -ne 'SIM'){Write-Host 'Cancelado';return}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$backupRoot=Join-Path $env:LOCALAPPDATA 'AgendaPro\backups'
New-Item -ItemType Directory -Path $backupRoot -Force|Out-Null
$backup=Join-Path $backupRoot ('auto-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$stage=Join-Path $backup 'verificado'
New-Item -ItemType Directory -Path $stage -Force|Out-Null
$modified=$false
try {
  foreach($name in $checks.Keys){
    $src=Join-Path $stage $name
    Invoke-WebRequest -Uri "$base/$name" -OutFile $src -UseBasicParsing -TimeoutSec 60
    if((Get-BlobSha $src) -ne $checks[$name]){throw "Arquivo $name não passou na verificação de integridade"}
  }
  $text=[System.IO.File]::ReadAllText((Join-Path $stage 'compose.yaml'))
  if($text -notmatch 'DISPATCH_ENABLED:\s*["'']false["'']' -or
     $text -notmatch 'ALLOW_ALL_BUSINESSES:\s*["'']false["'']' -or
     $text -notmatch 'TEST_AUTO_DISPATCH_ENABLED:') {throw 'Arquivo compose da versão aprovada não contém os bloqueios'}
  foreach($name in $checks.Keys){
    Copy-Item -LiteralPath (Join-Path $dir $name) -Destination (Join-Path $backup $name) -Force
  }
  Copy-Item -LiteralPath $envFile -Destination (Join-Path $backup 'env.local.bak') -Force
  $modified=$true
  foreach($name in $checks.Keys){
    Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $dir $name) -Force
  }
  $envText=[System.IO.File]::ReadAllText($envFile)
  if($envText -match '(?m)^\s*TEST_AUTO_DISPATCH_ENABLED\s*='){
    $envText=[regex]::Replace($envText,'(?m)^\s*TEST_AUTO_DISPATCH_ENABLED\s*=.*$', 'TEST_AUTO_DISPATCH_ENABLED=true')
  }else{
    $envText=$envText.TrimEnd([char]13,[char]10)+[Environment]::NewLine+'TEST_AUTO_DISPATCH_ENABLED=true'+[Environment]::NewLine
  }
  [System.IO.File]::WriteAllText($envFile,$envText,(New-Object System.Text.UTF8Encoding($false)))
  & docker compose --project-directory $dir -p $project -f $compose config --quiet
  if($LASTEXITCODE -ne 0){throw 'Docker compose config falhou'}
  & docker compose --project-directory $dir -p $project -f $compose up -d --build --force-recreate
  if($LASTEXITCODE -ne 0){throw 'Docker compose up falhou'}
  $new=Get-Container
  $newMount=@($new.Mounts|Where-Object {$_.Destination -eq '/data' -and $_.Type -eq 'volume'})
  if($newMount.Count -ne 1 -or [string]$newMount[0].Name -ne $volume){throw 'O volume de sessões foi alterado'}
  if((Get-Env $new 'DISPATCH_ENABLED') -ne 'false' -or
     (Get-Env $new 'TEST_AUTO_DISPATCH_ENABLED') -ne 'true' -or
     (Get-Env $new 'LOCAL_POLL_ENABLED') -ne 'true' -or
     (Get-Env $new 'ALLOW_ALL_BUSINESSES') -ne 'false' -or
     (Get-Env $new 'ALLOWED_BUSINESS_IDS') -ne $id){throw 'Variáveis de segurança não foram preservadas'}
  $healthy=$false
  for($n=0;$n -lt 30;$n++){
    Start-Sleep -Seconds 2
    try {
      $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8080/ready' -TimeoutSec 4
      if($r.ok -eq $true -and $r.database_ready -eq $true -and $r.dispatch_enabled -eq $false){$healthy=$true;break}
    }catch{}
  }
  if(-not $healthy){throw 'O Docker não ficou saudável'}
  $modified=$false
  Write-Host 'SUCESSO: TESTE AUTOMATICO ISOLADO ATIVADO.' -ForegroundColor Green
  Write-Host 'O WhatsApp pode levar alguns instantes para reconectar.'
  Write-Host 'Confirmação e lembrete já estão na fila; nada será recriado.'
} catch {
  Write-Host ('ERRO: '+$_.Exception.Message) -ForegroundColor Red
  if($modified){
    Write-Host 'Restaurando código e configuração anteriores.' -ForegroundColor Yellow
    foreach($name in $checks.Keys){
      $old=Join-Path $backup $name
      if(Test-Path $old){Copy-Item -LiteralPath $old -Destination (Join-Path $dir $name) -Force}
    }
    $oldEnv=Join-Path $backup 'env.local.bak'
    if(Test-Path $oldEnv){Copy-Item -LiteralPath $oldEnv -Destination $envFile -Force}
    & docker compose --project-directory $dir -p $project -f $compose up -d --build --force-recreate
  }
  throw
}
