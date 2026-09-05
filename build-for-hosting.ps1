﻿<#
  Trinitas ERP — build the upload package for Hostinger.

  Produces a `release` folder and a zip containing two things:

    public_html/   what the web serves — the React app plus one PHP entry point
    erp/           the Laravel application, kept OUTSIDE the web root so the
                   .env file and vendor tree cannot be requested over HTTP

  Run it by double-clicking "BUILD FOR HOSTING.bat".
#>

param(
    # Skips the "press Enter" prompts so the build can run unattended.
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$release = Join-Path $root 'release'

function Pause-IfInteractive([string]$prompt = '  Press Enter to close') {
    if ($NoPause) { return }
    # `Read-Host` throws in a non-interactive host (a CI runner, a script
    # calling this one) regardless of `-NoPause` — belt-and-braces so a
    # closing prompt, the least important line in this script, can never be
    # the reason an otherwise-successful build reports as failed.
    try { Read-Host $prompt | Out-Null } catch { }
}

function Step([string]$text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Note([string]$text) { Write-Host "       $text" -ForegroundColor DarkGray }
function Fail([string]$text) { Write-Host "  [X]  $text" -ForegroundColor Red }

if (-not $NoPause) { Clear-Host }
Write-Host ''
Write-Host '  ==========================================================' -ForegroundColor Red
Write-Host '   TRINITAS ERP  -  Build for Hostinger' -ForegroundColor Red
Write-Host '  ==========================================================' -ForegroundColor Red
Write-Host ''
Write-Host '  This packages everything for upload. It takes a few minutes.'

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
Step 'Checking tools...'

$php = @(Get-ChildItem 'C:\laragon\bin\php\*\php.exe' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName) | Select-Object -First 1
if (-not $php) { $php = (Get-Command php -ErrorAction SilentlyContinue).Source }
if (-not $php) { Fail 'PHP not found.'; Pause-IfInteractive; exit 1 }
Ok "PHP: $php"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail 'npm not found. Install Node.js and try again.'
    Pause-IfInteractive; exit 1
}
Ok 'npm found'

# ---------------------------------------------------------------------------
# 1. Front end
# ---------------------------------------------------------------------------
Step 'Building the web app...'

# Same-domain deployment, so the API is a relative path. No hostname is baked
# into the bundle, which means the same build works on any domain.
$env:VITE_API_URL = '/api/v1'

Push-Location (Join-Path $root 'web')
try {
    if (-not (Test-Path 'node_modules')) {
        Note 'Installing web dependencies (first run only)...'
        & npm install --no-audit --no-fund | Out-Null
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }
}
finally {
    Pop-Location
    Remove-Item Env:\VITE_API_URL -ErrorAction SilentlyContinue
}
Ok 'Web app built'

# ---------------------------------------------------------------------------
# 2. Assemble
# ---------------------------------------------------------------------------
Step 'Assembling the package...'

if (Test-Path $release) { Remove-Item $release -Recurse -Force }
New-Item -ItemType Directory -Path $release | Out-Null

$erp = Join-Path $release 'erp'
$pub = Join-Path $release 'public_html'
New-Item -ItemType Directory -Path $erp, $pub | Out-Null

# Laravel app, minus anything that is local-only, rebuildable, or a one-off
# QA script written for a terminal that will never exist on the live server.
& robocopy (Join-Path $root 'api') $erp /E /NFL /NDL /NJH /NJS /NP `
    /XD node_modules .git .github tests public release `
    /XF .env .env.backup database.sqlite .phpunit.result.cache *_qa.php e2e_*.php | Out-Null
if ($LASTEXITCODE -ge 8) { Fail 'Copying the application failed.'; Pause-IfInteractive; exit 1 }
Ok 'Laravel application copied'

# Storage must exist and be empty, but keep the folder structure Laravel needs.
foreach ($dir in @(
    'storage\app\public', 'storage\app\private\backups', 'storage\framework\cache\data',
    'storage\framework\sessions', 'storage\framework\views', 'storage\logs'
)) {
    $path = Join-Path $erp $dir
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Get-ChildItem $path -File -ErrorAction SilentlyContinue | Remove-Item -Force
    Set-Content -Path (Join-Path $path '.gitignore') -Value "*`n!.gitignore" -Encoding UTF8
}
Ok 'Storage folders prepared'

# Laravel's own public assets, then the React build on top.
#
# `storage` is excluded on purpose: locally it is a symlink into
# storage/app/public. Copying it would leave a real folder on the server, and
# `storage:link` refuses to run when its target already exists — so the
# installer would fail and uploaded logos would 404.
& robocopy (Join-Path $root 'api\public') $pub /E /NFL /NDL /NJH /NJS /NP `
    /XD storage /XF index.php .htaccess | Out-Null
& robocopy (Join-Path $root 'web\dist') $pub /E /NFL /NDL /NJH /NJS /NP | Out-Null
Ok 'Web root assembled'

Copy-Item (Join-Path $root 'deploy\index-public.php') (Join-Path $pub 'index.php') -Force
Copy-Item (Join-Path $root 'deploy\htaccess-public.txt') (Join-Path $pub '.htaccess') -Force
Copy-Item (Join-Path $root 'deploy\install.php') (Join-Path $pub 'install.php') -Force
Copy-Item (Join-Path $root 'deploy\env-production.txt') (Join-Path $erp '.env.example-production') -Force
Ok 'Entry point, rewrite rules and installer added'

# ---------------------------------------------------------------------------
# 3. Production dependencies
# ---------------------------------------------------------------------------
Step 'Installing production dependencies (no dev packages)...'

Push-Location $erp
try {
    # Composer writes progress to stderr. Redirecting it with 2>&1 would make
    # PowerShell treat those lines as a terminating error, so the exit code is
    # the only thing worth checking here.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & composer install --no-dev --optimize-autoloader --no-interaction --no-progress | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($code -ne 0) { throw "composer install failed (exit $code)." }
}
finally { Pop-Location }
Ok 'Dependencies installed'

# A cached config would freeze the local database credentials into the build.
Remove-Item (Join-Path $erp 'bootstrap\cache\*.php') -Force -ErrorAction SilentlyContinue
Ok 'Local caches cleared'

# ---------------------------------------------------------------------------
# 4. Zip
# ---------------------------------------------------------------------------
Step 'Creating the upload file...'

$zip = Join-Path $root ('trinitas-erp-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.zip')
Compress-Archive -Path (Join-Path $release '*') -DestinationPath $zip -CompressionLevel Optimal
$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Ok "$(Split-Path $zip -Leaf)  ($sizeMb MB)"

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '  ==========================================================' -ForegroundColor Green
Write-Host '   Package ready' -ForegroundColor Green
Write-Host '  ==========================================================' -ForegroundColor Green
Write-Host ''
Write-Host "   File   : $(Split-Path $zip -Leaf)"
Write-Host "   Folder : release\"
Write-Host ''
Write-Host '   It contains two folders:' -ForegroundColor Cyan
Write-Host '     public_html\  -> upload INTO your public_html'
Write-Host '     erp\          -> upload NEXT TO public_html, not inside it'
Write-Host ''
Write-Host '   Then open  https://yourdomain.com/install.php  in a browser.'
Write-Host ''
Write-Host '   Full instructions: HOSTINGER-DEPLOYMENT.md'
Write-Host ''
Pause-IfInteractive
