<#
Crea o completa api/.env para desarrollo local. Ejecútalo TÚ, desde la raíz del proyecto:

    powershell -ExecutionPolicy Bypass -File api/scripts/crear-env.ps1

- Copia api/.env.example si api/.env no existe, y agrega las variables que falten.
- Verifica con git que .env esté ignorado ANTES de escribir nada.
- Lee las llaves locales de Supabase con `supabase status` (la base local debe estar encendida).
- Te pide GEMINI_API_KEY con entrada oculta. No la imprime ni la registra en ningún lado.
- Si hay GEMINI_API_KEY, deja AI_PROVIDER=gemini y GEMINI_MODEL=gemini-3.6-flash (si estaba vacío).
  Sin clave, se queda con la IA simulada (AI_PROVIDER=mock).
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
# Ojo: el CLI escribe avisos (p. ej. "hay una versión nueva") por stderr; con 'Stop' PowerShell 5.1
# los convierte en error y abortaba la lectura sin avisar. Aquí se tolera y se verifica el resultado.
$prevPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$status = & supabase status -o env 2>$null
$ErrorActionPreference = $prevPreference
$map = @{}
foreach ($l in $status) {
    if ("$l" -match '^([A-Z_]+)="?([^"]*)"?$') { $map[$Matches[1]] = $Matches[2] }
}
if ($map['SERVICE_ROLE_KEY']) { $null = Set-Var 'SUPABASE_SERVICE_ROLE_KEY' $map['SERVICE_ROLE_KEY'] }
if ($map['JWT_SECRET']) { $null = Set-Var 'SUPABASE_JWT_SECRET' $map['JWT_SECRET'] }
$faltan = @()
foreach ($name in 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET') {
    if (-not (Get-Value $name)) { $faltan += $name }
}
if ($faltan.Count -gt 0) {
    Write-Host ('FALTAN en api/.env: ' + ($faltan -join ', ') + '. Enciende la base con "supabase start" y vuelve a ejecutar este script.') -ForegroundColor Red
} else {
    Write-Host 'Llaves locales de Supabase listas en api/.env.'
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

# 7. Proveedor de IA: Gemini si hay clave; si no, la IA simulada
if (Get-Value 'GEMINI_API_KEY') {
    $null = Set-Var 'AI_PROVIDER' 'gemini' -Force
    $null = Set-Var 'GEMINI_MODEL' 'gemini-3.6-flash'
    Write-Host ('IA: Gemini (' + (Get-Value 'GEMINI_MODEL') + ').')
} else {
    Write-Host 'IA: simulada (sin GEMINI_API_KEY).'
}

Write-Host ''
Write-Host 'Listo.'
