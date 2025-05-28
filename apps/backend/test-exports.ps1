param(
    [string[]]$Tests = @("transactions", "inventory", "customers", "daily-summary", "monthly-summary"),
    [switch]$LogToFile
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$exportDir = "test-exports"
$logFile = "$exportDir\export-log-$timestamp.txt"

function Log {
    param([string]$message, [string]$color = "Gray")
    Write-Host $message -ForegroundColor $color
    if ($LogToFile) {
        $message | Out-File -Append -FilePath $logFile
    }
}

# Anmeldeinformationen
$loginBody = @{
    email = "admin@clubtouch3.local"
    password = "Admin123!"
} | ConvertTo-Json -Depth 2

try {
    Log "Authentifiziere Benutzer..."
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody

    if (-not $loginResponse.accessToken) {
        throw "Kein Zugriffstoken erhalten - Login fehlgeschlagen."
    }

    $token = $loginResponse.accessToken
    $headers = @{ Authorization = "Bearer $token" }

    if (-not (Test-Path $exportDir)) {
        New-Item -ItemType Directory -Path $exportDir | Out-Null
    }

    # Verfügbare Exporte abrufen
    Log "`nVerfügbare Exporte:"
    $exports = Invoke-RestMethod -Uri "http://localhost:3001/api/exports" -Headers $headers
    $exports.exports | ForEach-Object {
        Log (" - {0} ({1}): {2}" -f $_.name, $_.format, $_.description)
    }

    # Funktion für einzelne Exporte
    function Export-File {
        param (
            [string]$Name,
            [string]$Url,
            [string]$Extension = "csv"
        )
        $filePath = "$exportDir\$Name-$timestamp.$Extension"
        Log "`nExportiere '$Name'..."
        try {
            Invoke-WebRequest -Uri $Url `
                -Method Get `
                -Headers $headers `
                -OutFile $filePath `
                -TimeoutSec 60
            Log "Export abgeschlossen: $filePath" "Green"
        } catch {
            Log "Fehler beim Export von '$Name': $_" "Red"
        }
    }

    # Tests einzeln ausführen
    if ("transactions" -in $Tests) {
        Export-File -Name "transaktionen" -Url "http://localhost:3001/api/exports/transactions"
    }

    if ("inventory" -in $Tests) {
        Export-File -Name "bestand" -Url "http://localhost:3001/api/exports/inventory"
    }

    if ("customers" -in $Tests) {
        Export-File -Name "kunden" -Url "http://localhost:3001/api/exports/customers"
    }

    if ("daily-summary" -in $Tests) {
        Export-File -Name "tagesabschluss" -Url "http://localhost:3001/api/exports/daily-summary" -Extension "pdf"
    }

    if ("monthly-summary" -in $Tests) {
        $now = Get-Date
        $year = $now.Year
        $month = $now.Month
        $uri = "http://localhost:3001/api/exports/monthly-summary?year=$year`&month=$month"
        Export-File -Name "monatsbericht" -Url $uri -Extension "pdf"
    }

    Log "`nAlle angeforderten Exporte abgeschlossen." "Cyan"

    Start-Process explorer.exe $exportDir
} catch {
    Log "`nFehler während des Tests: $_" "Red"
    exit 1
}
