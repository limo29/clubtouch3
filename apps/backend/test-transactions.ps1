# PowerShell Script zum Testen der Transaction-Endpoints von Clubtouch3

Write-Host "`n== Starte Test des Transaction-Managements ==" -ForegroundColor Green

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

# Hole Artikel und Kunden
Write-Host "`n== Lade Artikel und Kunden ==" -ForegroundColor Yellow

try {
    $articles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles" `
        -Method Get `
        -Headers $headers

    $customers = Invoke-RestMethod -Uri "http://localhost:3001/api/customers" `
        -Method Get `
        -Headers $headers
} catch {
    Write-Host "FEHLER beim Abrufen von Daten: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($articles.count -eq 0 -or $customers.count -eq 0) {
    Write-Host "FEHLER: Keine Artikel oder Kunden gefunden. Bitte zuerst Basisdaten anlegen." -ForegroundColor Red
    exit 1
}

# Test 1: Barverkauf
Write-Host "`n== Test 1: Barverkauf ==" -ForegroundColor Yellow

$saleBody = @{
    paymentMethod = "CASH"
    items = @(
        @{ articleId = $articles.articles[0].id; quantity = 2 }
    )
} | ConvertTo-Json -Depth 3

try {
    $sale = Invoke-RestMethod -Uri "http://localhost:3001/api/transactions" `
        -Method Post `
        -ContentType "application/json" `
        -Headers $headers `
        -Body $saleBody

    Write-Host "Barverkauf erfolgreich: €$($sale.transaction.totalAmount)" -ForegroundColor Green
    $transactionId = $sale.transaction.id
} catch {
    Write-Host "FEHLER beim Barverkauf: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Kundenkonto-Verkauf
Write-Host "`n== Test 2: Kundenkonto-Verkauf ==" -ForegroundColor Yellow

$customerWithBalance = $customers.customers | Where-Object { $_.balance -gt 0 } | Select-Object -First 1

if ($customerWithBalance) {
    $accountSaleBody = @{
        paymentMethod = "ACCOUNT"
        customerId = $customerWithBalance.id
        items = @(
            @{ articleId = $articles.articles[0].id; quantity = 1 }
        )
    } | ConvertTo-Json -Depth 3

    try {
        $accountSale = Invoke-RestMethod -Uri "http://localhost:3001/api/transactions" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $accountSaleBody

        Write-Host "Kundenkonto-Verkauf erfolgreich für $($customerWithBalance.name)" -ForegroundColor Green
    } catch {
        Write-Host "FEHLER beim Kundenkonto-Verkauf: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "Hinweis: Kein Kunde mit Guthaben gefunden." -ForegroundColor Yellow
}

# Test 3: Quick Sale
Write-Host "`n== Test 3: Quick Sale ==" -ForegroundColor Yellow

if ($articles.articles.Count -gt 1) {
    $quickSaleBody = @{
        articleId = $articles.articles[1].id
        quantity = 3
        paymentMethod = "CASH"
    } | ConvertTo-Json

    try {
        $quickSale = Invoke-RestMethod -Uri "http://localhost:3001/api/transactions/quick-sale" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $quickSaleBody

        Write-Host "Quick Sale erfolgreich: €$($quickSale.transaction.totalAmount)" -ForegroundColor Green
    } catch {
        Write-Host "FEHLER beim Quick Sale: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "Hinweis: Nicht genug Artikel für Quick Sale vorhanden." -ForegroundColor Yellow
}

# Test 4: Storno
if ($transactionId) {
    Write-Host "`n== Test 4: Storno ==" -ForegroundColor Yellow

    try {
        $cancel = Invoke-RestMethod -Uri "http://localhost:3001/api/transactions/$transactionId/cancel" `
            -Method Post `
            -Headers $headers

        Write-Host "Transaktion erfolgreich storniert." -ForegroundColor Green
    } catch {
        Write-Host "FEHLER beim Storno: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 5: Tagesabschluss
Write-Host "`n== Test 5: Tagesabschluss ==" -ForegroundColor Yellow

try {
    $summary = Invoke-RestMethod -Uri "http://localhost:3001/api/transactions/daily-summary" `
        -Method Get `
        -Headers $headers

    Write-Host "Tagesabschluss für $($summary.date):" -ForegroundColor Cyan
    Write-Host "  - Gesamtumsatz: €$($summary.summary.totalRevenue)"
    Write-Host "  - Transaktionen: $($summary.summary.totalTransactions)"
    Write-Host "  - Barumsatz: €$($summary.summary.cashRevenue)"
    Write-Host "  - Konto-Umsatz: €$($summary.summary.accountRevenue)"
} catch {
    Write-Host "FEHLER beim Tagesabschluss: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n== Test des Transaction-Managements abgeschlossen ==" -ForegroundColor Green
