# PowerShell Script zum Testen der Article-Endpoints von Clubtouch3

Write-Host "`n== Starte Test des Article-Managements ==" -ForegroundColor Green

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

# Erstelle Test-Artikel
Write-Host "`n== Erstelle Test-Artikel ==" -ForegroundColor Yellow

$articles = @(
    @{
        name = "Club Mate"
        price = 2.50
        category = "Getränke"
        unit = "Flasche"
        minStock = 24
        initialStock = 48
    },
    @{
        name = "Bier (0.5l)"
        price = 3.00
        category = "Getränke"
        unit = "Glas"
        minStock = 10
        initialStock = 100
    },
    @{
        name = "Chips"
        price = 1.50
        category = "Snacks"
        unit = "Tüte"
        minStock = 5
        initialStock = 20
    }
)

foreach ($article in $articles) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3001/api/articles" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body ($article | ConvertTo-Json -Depth 3)
        
        Write-Host "Artikel erstellt: $($response.article.name) - €$($response.article.price)" -ForegroundColor Green
    } catch {
        Write-Host "Warnung: Fehler beim Erstellen von '$($article.name)': $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Liste alle Artikel
Write-Host "`n== Liste aller Artikel ==" -ForegroundColor Yellow

try {
    $allArticles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles" `
        -Method Get `
        -Headers $headers

    $articleCount = if ($allArticles.articles) { $allArticles.articles.Count } else { 0 }
    Write-Host "Gefundene Artikel: $articleCount" -ForegroundColor Cyan

    $allArticles.articles | ForEach-Object {
        Write-Host "  - Name: $($_.name), Preis: €$($_.price), Bestand: $($_.stock) $($_.unit)"
    }
} catch {
    Write-Host "FEHLER beim Abrufen der Artikel: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Teste Wareneingang für ersten Artikel
if ($allArticles.articles.Count -gt 0) {
    $firstArticle = $allArticles.articles[0]
    Write-Host "`n== Teste Wareneingang für '$($firstArticle.name)' ==" -ForegroundColor Yellow
    
    $deliveryBody = @{
        quantity = 24
        reason = "Test-Lieferung"
    } | ConvertTo-Json

    try {
        $delivery = Invoke-RestMethod -Uri "http://localhost:3001/api/articles/$($firstArticle.id)/delivery" `
            -Method Post `
            -ContentType "application/json" `
            -Headers $headers `
            -Body $deliveryBody

        Write-Host "Neuer Bestand für '$($delivery.article.name)': $($delivery.article.stock) $($delivery.article.unit)" -ForegroundColor Green
    } catch {
        Write-Host "FEHLER beim Wareneingang: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Prüfe niedrige Bestände
Write-Host "`n== Prüfe niedrige Bestände ==" -ForegroundColor Yellow

try {
    $lowStock = Invoke-RestMethod -Uri "http://localhost:3001/api/articles/low-stock" `
        -Method Get `
        -Headers $headers

    if ($lowStock.hasWarnings) {
        Write-Host "Achtung: Es gibt Artikel mit niedrigem Bestand (Gesamt: $($lowStock.count))" -ForegroundColor Red
    } else {
        Write-Host "Alle Artikel haben ausreichend Bestand." -ForegroundColor Green
    }
} catch {
    Write-Host "FEHLER beim Abrufen der Bestandswarnungen: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n== Test des Article-Managements abgeschlossen ==" -ForegroundColor Green
