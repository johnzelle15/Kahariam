[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '', Justification = 'mysql CLI requires plain text password argument.')]
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidAssignmentToAutomaticVariable', '', Justification = 'False positive from analyzer; script does not assign automatic variables.')]
param(
    [string]$DbServer = $(if ($env:DB_HOST) { $env:DB_HOST } else { '127.0.0.1' }),
    [int]$DbPort = $(if ($env:DB_PORT) { [int]$env:DB_PORT } else { 3306 }),
    [string]$DbName = $(if ($env:DB_NAME) { $env:DB_NAME } else { 'inventory' }),
    [string]$DbUser = $(if ($env:DB_USER) { $env:DB_USER } else { 'fishuser' }),
    [SecureString]$DbPasswordSecure = $(
        if ($env:DB_PASSWORD) {
            ConvertTo-SecureString -String $env:DB_PASSWORD -AsPlainText -Force
        }
        else {
            ConvertTo-SecureString -String '' -AsPlainText -Force
        }
    )
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$schemaFile = Join-Path $projectRoot 'sql\schema.sql'
$migrationFiles = @(
    Join-Path $projectRoot 'sql\migrate_inventory_action_enum_mariadb.sql'
)

# Defensive defaults (helps when parts of this file are executed in isolation)
if ([string]::IsNullOrWhiteSpace($DbServer)) { $DbServer = '127.0.0.1' }
if (-not $DbPort -or $DbPort -le 0) { $DbPort = 3306 }
if ([string]::IsNullOrWhiteSpace($DbName)) { $DbName = 'inventory' }
if ([string]::IsNullOrWhiteSpace($DbUser)) { $DbUser = 'fishuser' }
if ($null -eq $DbPasswordSecure) {
    $DbPasswordSecure = ConvertTo-SecureString -String '' -AsPlainText -Force
}

$DbPasswordPlain = [System.Net.NetworkCredential]::new('', $DbPasswordSecure).Password

function Get-MySqlExe {
    $known = @(
        'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
        'C:\Program Files\MariaDB 11.4\bin\mariadb.exe',
        'C:\Program Files\MariaDB 11.3\bin\mariadb.exe',
        'C:\Program Files\MariaDB 11.2\bin\mariadb.exe'
    )

    foreach ($path in $known) {
        if (Test-Path $path) { return $path }
    }

    $mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
    if ($mysqlCmd) { return $mysqlCmd.Source }

    $mariadbCmd = Get-Command mariadb -ErrorAction SilentlyContinue
    if ($mariadbCmd) { return $mariadbCmd.Source }

    throw 'Could not find mysql/mariadb CLI. Install MySQL/MariaDB client tools or update this script path list.'
}

function Invoke-SqlFile {
    param(
        [string]$Exe,
        [string]$FilePath,
        [string]$DbServer,
        [int]$Port,
        [string]$User,
        [string]$Database
    )

    if (!(Test-Path $FilePath)) {
        throw ('SQL file not found: {0}' -f $FilePath)
    }

    Write-Host ('Applying: {0}' -f $FilePath)
    $sql = Get-Content -Path $FilePath -Raw

    if ([string]::IsNullOrWhiteSpace($sql)) {
        Write-Host ('Skipped empty file: {0}' -f $FilePath)
        return
    }

    $mysqlArguments = @(
        ('--host={0}' -f $DbServer),
        ('--port={0}' -f $Port),
        ('--user={0}' -f $User)
    )

    if ($script:DbPasswordPlain -ne '') {
        $mysqlArguments += ('--password={0}' -f $script:DbPasswordPlain)
    }

    if ($Database -ne '') {
        $mysqlArguments += $Database
    }

    $sql | & $Exe @mysqlArguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Failed applying SQL file: {0}' -f $FilePath)
    }
}

$cli = Get-MySqlExe
Write-Host ('Using SQL CLI: {0}' -f $cli)
Write-Host ('Target DB: {0}@{1}:{2}/{3}' -f $DbUser, $DbServer, $DbPort, $DbName)

# Ensure database exists before applying schema/migrations
$createDbArgs = @(
    ('--host={0}' -f $DbServer),
    ('--port={0}' -f $DbPort),
    ('--user={0}' -f $DbUser)
)
if ($DbPasswordPlain -ne '') { $createDbArgs += ('--password={0}' -f $DbPasswordPlain) }
$createDbArgs += @('-e', "CREATE DATABASE IF NOT EXISTS $DbName CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;")

& $cli @createDbArgs
if ($LASTEXITCODE -ne 0) {
    throw ('Failed creating/ensuring database: {0}' -f $DbName)
}

Invoke-SqlFile -Exe $cli -FilePath $schemaFile -DbServer $DbServer -Port $DbPort -User $DbUser -Database $DbName
foreach ($migrationFile in $migrationFiles) {
    Invoke-SqlFile -Exe $cli -FilePath $migrationFile -DbServer $DbServer -Port $DbPort -User $DbUser -Database $DbName
}

Write-Host 'Migrations applied successfully.'
