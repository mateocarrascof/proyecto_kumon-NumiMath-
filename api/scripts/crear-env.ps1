<#
Crea o completa api/.env para desarrollo local. Ejecútalo TÚ, desde la raíz del proyecto:

    powershell -ExecutionPolicy Bypass -File api/scripts/crear-env.ps1

- Copia api/.env.example si api/.env no existe, y agrega las variables que falten.
- Verifica con git que .env esté ignorado ANTES de escribir nada.
- Lee las llaves locales de Supabase con `supabase status` (la base local debe estar encendida).
- Te pide GEMINI_API_KEY con entrada oculta. No la imprime ni la registra en ningún lado.
- GEMINI_MODEL queda VACÍO a propósito: elige tú un nombre de versión estable
  (https://ai.google.dev/gemini-api/docs/models) y escríbelo en api/.env.
#>
$ErrorActionPreference = 'Stop'
$api = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $api '.env'
$template = Join-Path $api '.env.example'

# 1. .env debe estar ignorado por git
Push-Location $api
git check-ignore -q .env
$ignored = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $ignored) {
    Write-Host 'ABORTADO: git no ignora api/.env. Agrégalo a .gitignore antes de continuar.' -ForegroundColor Red
    exit 1
}

# 2. Base: copia de la plantilla
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $template)) { Write-Host 'No encuentro api/.env.example.' -ForegroundColor Red; exit 1 }
    Copy-Item $template $envFile
    Write-Host 'Creado api/.env desde la plantilla.'
}

function Get-Lines { [System.IO.File]::ReadAllLines($envFile) }
function Get-Value([string]$key) {
    foreach ($l in Get-Lines) { if ($l -match "^\s*$key\s*=(.*)$") { return $Matches[1].Trim() } }
    return $null
}
# Escribe la variable si no existe o está vacía (o siempre con -Force). No imprime el valor.
function Set-Var([string]$key, [string]$value, [switch]$Force) {
    $lines = [System.Collections.Generic.List[string]](Get-Lines)
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*$key\s*=") { $idx = $i; break } }
    if ($idx -ge 0) {
        $current = ($lines[$idx] -replace "^\s*$key\s*=", '').Trim()
        if ($current -ne '' -and -not $Force) { return $false }
        $lines[$idx] = "$key=$value"
    } else { $lines.Add("$key=$value") }
    [System.IO.File]::WriteAllLines($envFile, $lines)
    return $true
}

# 3. Valores fijos de desarrollo (solo si faltan)
$null = Set-Var 'APP_ENV' 'local'
$null = Set-Var 'AI_PROVIDER' 'mock'
$null = Set-Var 'CORS_ORIGINS' 'http://localhost:8100'
$null = Set-Var 'SUPABASE_URL' 'http://127.0.0.1:54321'
$null = Set-Var 'JWT_AUDIENCE' 'authenticated'
$null = Set-Var 'JWT_ISSUER' 'http://127.0.0.1:54321/auth/v1'
if (-not (Get-Value 'GEMINI_MODEL')) { $null = Set-Var 'GEMINI_MODEL' '' }

# 4. Llaves aleatorias propias de esta máquina
function New-Secret { $b = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) }
$null = Set-Var 'EXERCISE_SIGNING_KEY' (New-Secret)

# 5. Llaves locales de Supabase
try {
    $status = supabase status -o env 2>$null
    $map = @{}
    foreach ($l in $status) { if ($l -match '^([A-Z_]+)="?([^"]*)"?$') { $map[$Matches[1]] = $Matches[2] } }
    if ($map['SERVICE_ROLE_KEY']) { $null = Set-Var 'SUPABASE_SERVICE_ROLE_KEY' $map['SERVICE_ROLE_KEY'] }
    if ($map['JWT_SECRET']) { $null = Set-Var 'SUPABASE_JWT_SECRET' $map['JWT_SECRET'] }
    if ($map['ANON_KEY']) { Write-Host "ANON_KEY local (va en la app, no es secreta): ver 'supabase status'." }
} catch {
    Write-Host "Aviso: no pude leer 'supabase status'. ¿Está encendida la base local?" -ForegroundColor Yellow
}

# 6. Clave de Gemini (entrada oculta, opcional)
if (-not (Get-Value 'GEMINI_API_KEY')) {
    $secure = Read-Host 'GEMINI_API_KEY (Enter para omitir; no se muestra)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($plain) { $null = Set-Var 'GEMINI_API_KEY' $plain; $plain = $null; Write-Host 'GEMINI_API_KEY guardada en api/.env.' }
    else { Write-Host 'GEMINI_API_KEY omitida (puedes volver a ejecutar el script).' }
}

Write-Host ''
Write-Host 'Listo. Pendiente de tu parte: escribir GEMINI_MODEL en api/.env (nombre de versión estable).'
Write-Host 'Lista de modelos: https://ai.google.dev/gemini-api/docs/models'
