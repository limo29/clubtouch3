# Clubtouch3 User Management Test Script

Write-Host "`n== Starte Clubtouch3 User-Management Test ==" -ForegroundColor Green

# Login als Admin
Write-Host "`n== Login als Admin ==" -ForegroundColor Yellow
$loginBody = @{
    email = "admin@clubtouch3.local"
    password = "Admin123!"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3001/api/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody

    Write-Host "Login-Response erhalten:" -ForegroundColor Magenta
    $loginResponse | ConvertTo-Json -Depth 5 | Write-Host

    $token = $loginResponse.accessToken

    if (-not $token) {
        Write-Host "FEHLER: Kein Access Token im Login-Response gefunden!" -ForegroundColor Red
        exit 1
    }

    Write-Host "Token erfolgreich abgerufen: $token" -ForegroundColor Cyan
} catch {
    Write-Host "FEHLER beim Login: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$headers = @{
    Authorization = "Bearer $token"
}

Write-Host "Login erfolgreich!" -ForegroundColor Green

# Liste alle User
Write-Host "`n== Liste alle Benutzer ==" -ForegroundColor Yellow
try {
    $users = Invoke-RestMethod -Uri "http://localhost:3001/api/users" `
        -Method Get `
        -Headers $headers

    $userCount = if ($users.users) { $users.users.Count } else { 0 }
    Write-Host "Benutzer gefunden: $userCount" -ForegroundColor Cyan

    $users.users | ForEach-Object {
        Write-Host "  - Name: $($_.name), Email: $($_.email), Rolle: $($_.role)"
    }
} catch {
    Write-Host "FEHLER beim Abrufen der Benutzerliste: $($_.Exception.Message)" -ForegroundColor Red
}

# Erstelle neuen Kassierer
Write-Host "`n== Erstelle neuen Benutzer (Rolle: Kassierer) ==" -ForegroundColor Yellow
$newUserBody = @{
    email = "kassierer@clubtouch3.local"
    password = "Kasse123!"
    name = "Max Kassierer"
    role = "CASHIER"
} | ConvertTo-Json

try {
    $newUser = Invoke-RestMethod -Uri "http://localhost:3001/api/users" `
        -Method Post `
        -ContentType "application/json" `
        -Headers $headers `
        -Body $newUserBody

    Write-Host "Neuer Benutzer erstellt: $($newUser.user.name)" -ForegroundColor Green
} catch {
    Write-Host "Warnung: Benutzer konnte nicht erstellt werden (möglicherweise existiert er bereits): $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n== Test abgeschlossen ==" -ForegroundColor Green
