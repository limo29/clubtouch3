# PowerShell Script zum Testen der Customer-Endpoints von Clubtouch3

Write-Host "`n== Starte Test des Customer-Managements ==" -ForegroundColor Green

# Login
$loginBody = @{
    email = "admin@clubtouch3.local"
    password = "Admin123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody

    $token = $loginResponse.accessToken

    if (-not $token) {
        Write-Host "FEHLER: Kein Access Token erhalten." -ForegroundColor Red
        exit 1
    }

    $headers = @{
        Authorization = "Bearer $token"
    }

    Write-Host "Login erfolgreich." -ForegroundColor Green
} catch {
    Write-Host "FEHLER beim Login: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Erstelle Test-Kunden
Write-Host "`n== Erstelle Test-Kunden ==" -ForegroundColor Yellow

$customers = @(
    @{ name = "Lisa Schmidt"; nickname = "Schmidti" },
    @{ name = "Jonas Weber"; nickname = $null },
    @{ name = "Anna Müller"; nickname = "Annie" }
)

$createdCustomers = @()

foreach ($customer in $customers) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3001/api/customers" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body ($customer | ConvertTo-Json -Depth 3)

        Write-Host "Kunde erstellt: $($response.customer.name)" -ForegroundColor Green
        $createdCustomers += $response.customer
    } catch {
        Write-Host "Warnung: Fehler beim Erstellen von '$($customer.name)': $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Lade Guthaben auf
if ($createdCustomers.Count -gt 0) {
    Write-Host "`n== Lade Guthaben auf für ersten Kunden ==" -ForegroundColor Yellow

    $firstCustomer = $createdCustomers[0]
    $topUpBody = @{
        amount = 20.00
        method = "CASH"
        reference = "Test-Aufladung"
    } | ConvertTo-Json

    try {
        $topUp = Invoke-RestMethod -Uri "http://localhost:3001/api/customers/$($firstCustomer.id)/topup" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $topUpBody

        Write-Host "Guthaben aufgeladen: $($topUp.customer.name) - Neues Guthaben: €$($topUp.customer.balance)" -ForegroundColor Green
    } catch {
        Write-Host "FEHLER beim Aufladen: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Liste alle Kunden
Write-Host "`n== Liste aller Kunden ==" -ForegroundColor Yellow

try {
    $allCustomers = Invoke-RestMethod -Uri "http://localhost:3001/api/customers" `
        -Method Get `
        -Headers $headers

    $customerCount = if ($allCustomers.customers) { $allCustomers.customers.Count } else { 0 }
    Write-Host "Gefundene Kunden: $customerCount" -ForegroundColor Cyan

    $allCustomers.customers | ForEach-Object {
        $nickname = if ($_.nickname) { " ($($_.nickname))" } else { "" }
        Write-Host "  - Name: $($_.name)$nickname - Guthaben: €$($_.balance)"
    }
} catch {
    Write-Host "FEHLER beim Abrufen der Kunden: $($_.Exception.Message)" -ForegroundColor Red
}

# Suche Kunden
Write-Host "`n== Teste Kundensuche ==" -ForegroundColor Yellow

try {
    $searchResult = Invoke-RestMethod -Uri "http://localhost:3001/api/customers?search=Schmidt" `
        -Method Get `
        -Headers $headers

    Write-Host "Suchergebnisse für 'Schmidt': $($searchResult.count) Kunde(n)" -ForegroundColor Cyan
} catch {
    Write-Host "FEHLER bei Kundensuche: $($_.Exception.Message)" -ForegroundColor Red
}

# Prüfe niedrige Guthaben
Write-Host "`n== Prüfe niedrige Guthaben ==" -ForegroundColor Yellow

try {
    $lowBalance = Invoke-RestMethod -Uri "http://localhost:3001/api/customers/low-balance?threshold=10" `
        -Method Get `
        -Headers $headers

    Write-Host "Kunden mit Guthaben unter €10: $($lowBalance.count)" -ForegroundColor Cyan
} catch {
    Write-Host "FEHLER beim Abrufen niedriger Guthaben: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n== Test des Customer-Managements abgeschlossen ==" -ForegroundColor Green
