# Carga la clave de la API de Claude como secreto de Supabase, para el dictado con IA.
# La pedís en https://console.anthropic.com (API Keys). Al pegarla acá no se ve en pantalla, y no queda en ningún archivo.
# La usa solo la función del servidor: nunca llega al navegador ni al celular.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
$s = Join-Path $env:USERPROFILE 'HysTools\supabase.exe'

Write-Host ''
Write-Host 'Pegá la clave de Claude (empieza con sk-ant-) y apretá Enter. No se va a ver lo que pegues.' -ForegroundColor Cyan
$segura = Read-Host -AsSecureString 'Clave'
$puntero = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
$clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($puntero).Trim()
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($puntero)

if (-not $clave.StartsWith('sk-ant-')) {
  Write-Host ''
  Write-Host 'Eso no parece una clave de Claude: tiene que empezar con sk-ant-. No se guardó nada.' -ForegroundColor Red
  exit 1
}
& $s secrets set "ANTHROPIC_API_KEY=$clave" --project-ref obnuhhublcbdaolfpsjh --yes | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'No se pudo guardar la clave.' -ForegroundColor Red; exit 1 }
Write-Host ''
Write-Host 'Listo: la clave quedó guardada en el servidor. Avisale a Claude.' -ForegroundColor Green
