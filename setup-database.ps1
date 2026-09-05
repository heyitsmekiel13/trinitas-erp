<#
  Trinitas ERP — one-click database setup.

  Creates the MySQL database, creates a dedicated application user, writes the
  connection details into api\.env, then builds all the tables and reference
  data.

  Your MySQL root password is typed here, used once to connect, and never
  written to disk or displayed. The application itself never uses root — it
  gets its own limited account.

  Run it by double-clicking "SETUP DATABASE.bat" in this folder.
#>

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Say([string]$text, [string]$colour = 'Gray') { Write-Host $text -ForegroundColor $colour }
function Step([string]$text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Fail([string]$text) { Write-Host "  [X]  $text" -ForegroundColor Red }

Clear-Host
Say ''
Say '  ==========================================================' 'Red'
Say '   TRINITAS ERP  -  Database Setup' 'Red'
Say '  ==========================================================' 'Red'
Say ''
Say '  This will create the "trinitas_erp" database in MySQL and'
Say '  build every table the ERP needs. It is safe to run again.'
Say ''

# ---------------------------------------------------------------------------
# 1. Locate the tools
# ---------------------------------------------------------------------------
Step 'Looking for MySQL and PHP...'

$mysqlCandidates = @(
    'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
    'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe',
    'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe',
    'C:\xampp\mysql\bin\mysql.exe'
)
$mysql = $mysqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $mysql) { $mysql = (Get-Command mysql -ErrorAction SilentlyContinue).Source }
if (-not $mysql) {
    Fail 'Could not find mysql.exe. Install MySQL Server, then run this again.'
    Read-Host '  Press Enter to close'
    exit 1
}
Ok "MySQL client: $mysql"

$phpCandidates = @(Get-ChildItem 'C:\laragon\bin\php\*\php.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$php = $phpCandidates | Select-Object -First 1
if (-not $php) { $php = (Get-Command php -ErrorAction SilentlyContinue).Source }
if (-not $php) {
    Fail 'Could not find php.exe. Install PHP 8.2+ (Laragon includes it), then run this again.'
    Read-Host '  Press Enter to close'
    exit 1
}
Ok "PHP: $php"

# ---------------------------------------------------------------------------
# 2. Connection details
# ---------------------------------------------------------------------------
Step 'MySQL connection'

$dbHost = Read-Host '  Host [localhost]'
if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost = 'localhost' }

$dbPort = Read-Host '  Port [3306]'
if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort = '3306' }

$rootUser = Read-Host '  MySQL admin username [root]'
if ([string]::IsNullOrWhiteSpace($rootUser)) { $rootUser = 'root' }

Say ''
Say '  Enter the MySQL password for that account.' 'Yellow'
Say '  (Nothing appears as you type. It is never saved or shown.)' 'DarkGray'
$secure = Read-Host '  Password' -AsSecureString
$rootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)

$dbName = 'trinitas_erp'
$appUser = 'trinitas_app'

# A strong random password for the application account, generated locally.
$bytes = New-Object 'System.Byte[]' 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$appPassword = ([Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', '') + 'aA1!'

# ---------------------------------------------------------------------------
# 3. Create the database and application user
# ---------------------------------------------------------------------------
Step "Creating database '$dbName'..."

$sql = @"
CREATE DATABASE IF NOT EXISTS ``$dbName``
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '$appUser'@'localhost' IDENTIFIED BY '$appPassword';
ALTER USER '$appUser'@'localhost' IDENTIFIED BY '$appPassword';
GRANT ALL PRIVILEGES ON ``$dbName``.* TO '$appUser'@'localhost';
FLUSH PRIVILEGES;
SELECT 'done' AS status;
"@

$sqlFile = Join-Path $env:TEMP "trinitas-setup-$([guid]::NewGuid()).sql"
Set-Content -Path $sqlFile -Value $sql -Encoding UTF8

# MYSQL_PWD keeps the password off the command line and out of the process list.
$env:MYSQL_PWD = $rootPassword
try {
    $output = & $mysql --host=$dbHost --port=$dbPort --user=$rootUser --protocol=TCP --default-character-set=utf8mb4 -e "source $($sqlFile -replace '\\','/')" 2>&1
    $exit = $LASTEXITCODE
}
finally {
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    $env:MYSQL_PWD = $null
    $rootPassword = $null
}

if ($exit -ne 0) {
    Fail 'MySQL refused the connection.'
    Say ''
    Say ($output | Out-String) 'DarkGray'
    Say '  Most likely the password was wrong, or the MySQL service is stopped.' 'Yellow'
    Say '  Check Services -> MySQL80 is Running, then try again.' 'Yellow'
    Read-Host '  Press Enter to close'
    exit 1
}
Ok "Database '$dbName' ready"
Ok "Application user '$appUser' created"

# ---------------------------------------------------------------------------
# 4. Point Laravel at the database
# ---------------------------------------------------------------------------
Step 'Writing connection settings into api\.env...'

$envPath = Join-Path $root 'api\.env'
$envExample = Join-Path $root 'api\.env.example'
if (-not (Test-Path $envPath)) {
    if (Test-Path $envExample) { Copy-Item $envExample $envPath }
    else { New-Item -ItemType File -Path $envPath | Out-Null }
}

$settings = [ordered]@{
    'DB_CONNECTION' = 'mysql'
    'DB_HOST'       = $dbHost
    'DB_PORT'       = $dbPort
    'DB_DATABASE'   = $dbName
    'DB_USERNAME'   = $appUser
    'DB_PASSWORD'   = $appPassword
}

$lines = @(Get-Content $envPath -ErrorAction SilentlyContinue)
foreach ($key in $settings.Keys) {
    $value = $settings[$key]
    # Quote the value so special characters in the generated password survive.
    $line = "$key=`"$value`""
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*#?\s*$key\s*=") {
            $lines[$i] = $line
            $found = $true
            break
        }
    }
    if (-not $found) { $lines += $line }
}
Set-Content -Path $envPath -Value $lines -Encoding UTF8
Ok 'api\.env updated'

# ---------------------------------------------------------------------------
# 5. Build the tables
# ---------------------------------------------------------------------------
Push-Location (Join-Path $root 'api')
try {
    if (-not (Test-Path 'vendor\autoload.php')) {
        Step 'Installing PHP dependencies (first run only, this takes a minute)...'
        & composer install --no-interaction --no-progress
    }

    $envText = Get-Content '.env' -Raw
    if ($envText -notmatch 'APP_KEY="?base64:') {
        Step 'Generating application key...'
        & $php artisan key:generate --force | Out-Null
    }

    Step 'Creating tables and reference data...'
    & $php artisan migrate --force
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed.' }

    & composer dump-autoload --quiet
    # DatabaseSeeder loads access control, the company structure and the
    # statutory rate tables. It adds no transactional data.
    & $php artisan db:seed --force
    if ($LASTEXITCODE -ne 0) { throw 'Seeding failed.' }

    Ok 'Tables created and reference data loaded'
}
catch {
    Fail $_.Exception.Message
    Say ''
    Say '  The database exists but the tables were not built.' 'Yellow'
    Say '  Open a terminal in the api folder and run:  php artisan migrate --seed' 'Yellow'
    Pop-Location
    Read-Host '  Press Enter to close'
    exit 1
}
Pop-Location

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------
Say ''
Say '  ==========================================================' 'Green'
Say '   Setup complete' 'Green'
Say '  ==========================================================' 'Green'
Say ''
Say "   Database    : $dbName"
Say "   Host        : $dbHost`:$dbPort"
Say "   App user    : $appUser"
Say '   Password    : saved in api\.env (you never need to type it)'
Say ''
Say '  To view the data in MySQL Workbench:' 'Cyan'
Say '   1. Open MySQL Workbench'
Say '   2. Click your "Local instance MySQL80" connection'
Say "   3. In the left panel under SCHEMAS, click  $dbName"
Say '   4. Expand Tables to see employees, payroll_runs, payslips, and the rest'
Say ''
Say '  Sign in to the ERP with:' 'Cyan'
Say '   Username  superadmin'
Say '   Password  admin123     <-- change this in Admin > Users'
Say ''
Read-Host '  Press Enter to close'
