# Activa el servidor de Relevamientos HyS. Se corre una sola vez, desde el Terminal, con la sesión de Supabase ya iniciada:
#   1. Sube las funciones del servidor (avisos).
#   2. Genera las claves de los avisos y las guarda como secretos en Supabase. No se muestran ni quedan en ningún archivo.
#   3. Escribe en app/sync.js solo la clave pública, que es la que necesita la app.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$s = Join-Path $env:USERPROFILE 'HysTools\supabase.exe'
$ref = 'obnuhhublcbdaolfpsjh'
function Base64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function Revisar($paso) { if ($LASTEXITCODE -ne 0) { Write-Host ''; Write-Host "No se pudo completar: $paso. Copiale a Claude lo que aparece arriba." -ForegroundColor Red; exit 1 } }

Write-Host ''
Write-Host '1 de 3 - Subiendo las funciones del servidor (tarda un par de minutos)...' -ForegroundColor Cyan
& $s functions deploy avisos --no-verify-jwt --project-ref $ref --yes
Revisar 'subir las funciones'

$sync = Join-Path $raiz 'app\sync.js'
$texto = [IO.File]::ReadAllText($sync, [Text.Encoding]::UTF8)
if ($texto.Contains('__VAPID_PUBLICA__')) {
  Write-Host ''
  Write-Host '2 de 3 - Generando las claves de los avisos y guardándolas en Supabase...' -ForegroundColor Cyan
  $ec = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
  $par = $ec.ExportParameters($true)
  [byte[]]$crudo = @([byte]4) + $par.Q.X + $par.Q.Y
  $publica = Base64Url $crudo
  $privada = Base64Url $par.D
  $azar = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($azar)
  $cron = ($azar | ForEach-Object { $_.ToString('x2') }) -join ''

  & $s secrets set "VAPID_PUBLICA=$publica" "VAPID_PRIVADA=$privada" "AVISOS_CLAVE=$cron" --project-ref $ref --yes | Out-Null
  Revisar 'guardar los secretos'
  & $s db query "select vault.create_secret('$cron', 'avisos_clave') is not null as creado" --linked --yes | Out-Null
  Revisar 'guardar la clave de las tareas programadas'

  Write-Host ''
  Write-Host '3 de 3 - Anotando la clave pública en la app...' -ForegroundColor Cyan
  [IO.File]::WriteAllText($sync, $texto.Replace('__VAPID_PUBLICA__', $publica), (New-Object Text.UTF8Encoding $false))
} else {
  Write-Host ''
  Write-Host 'Las claves de los avisos ya estaban generadas: no se tocan.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Listo. Avisale a Claude.' -ForegroundColor Green
