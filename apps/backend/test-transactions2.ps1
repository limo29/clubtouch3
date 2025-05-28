#Requires -Version 5.1

<#
.SYNOPSIS
    PowerShell Script to comprehensively test Clubtouch3 Transaction Endpoints and Highscore Population.
.DESCRIPTION
    This script logs in, ensures necessary test articles (marked for highscore) and customers exist (creating them if needed),
    creates various transactions, and performs other tests like cancellation and daily summary.
.NOTES
    Author: AI Assistant (based on user's code and requests)
    Version: 3.1 - Addresses 400 errors by increasing test customer balance and adding payload debug.
    Ensure the backend API is running at the specified URL.
    The script relies on specific API behavior for creating and listing articles/customers.
#>

# --- Configuration ---
$Global:BaseUrl = "http://localhost:3001/api"
$Global:AdminEmail = "admin@clubtouch3.local"
$Global:AdminPassword = "Admin123!"
$Global:AuthToken = $null
$Global:ApiHeaders = $null

# --- Helper Functions ---

Function Login-App {
    param(
        [string]$Email,
        [string]$Password
    )
    Write-Host "`nAttempting Login for user: $Email..." -ForegroundColor Cyan
    $loginBody = @{
        email    = $Email
        password = $Password
    } | ConvertTo-Json

    try {
        $loginResponse = Invoke-RestMethod -Uri "$Global:BaseUrl/auth/login" `
            -Method Post `
            -ContentType "application/json" `
            -Body $loginBody `
            -ErrorAction Stop

        $Global:AuthToken = $loginResponse.accessToken
        if (-not $Global:AuthToken) {
            Write-Error "Login failed: No Access Token received."
            return $false
        }

        $Global:ApiHeaders = @{
            Authorization = "Bearer $($Global:AuthToken)"
        }
        Write-Host "Login successful. Token acquired." -ForegroundColor Green
        return $true
    }
    catch {
        Write-Error "Login failed: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            Write-Host "Status Code: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor DarkRed
            try {
                $errorResponseStream = $_.Exception.Response.GetResponseStream()
                $streamReader = New-Object System.IO.StreamReader($errorResponseStream)
                Write-Host "Error Response Body: $($streamReader.ReadToEnd())" -ForegroundColor DarkGray
                $streamReader.Dispose(); $errorResponseStream.Dispose()
            } catch { Write-Host "Could not read error response body." -ForegroundColor DarkGray }
        }
        return $false
    }
}

Function Invoke-ApiRequest {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [object]$Body = $null,
        [Hashtable]$Headers = $Global:ApiHeaders,
        [switch]$SkipAuth,
        [switch]$ReturnFullResponse
    )
    Write-Host "API Request: $Method $Uri" -ForegroundColor Gray
    if ($Body -and $Method -ne "GET") { # Only print body for relevant methods
        Write-Host "Request Body (DEBUG): $Body" -ForegroundColor DarkCyan
    }
    $invokeParams = @{
        Uri         = $Uri
        Method      = $Method
        ErrorAction = 'SilentlyContinue'
    }
    if (-not $SkipAuth) {
        if (-not $Headers) {
            Write-Error "Cannot make authenticated API request: ApiHeaders not set. Please login first."
            return $null
        }
        $invokeParams.Headers = $Headers
    }
    if ($Body) {
        $invokeParams.Body = $Body
        $invokeParams.ContentType = "application/json"
    }
    if ($ReturnFullResponse) {
        $invokeParams.PassThru = $true
    }

    try {
        $responseObject = Invoke-RestMethod @invokeParams
        return $responseObject # For success, this is usually the parsed body or HttpResponseMessage
    }
    catch {
        $errorMessage = "Invoke-ApiRequest : API Call Failed for $Method $Uri : $($_.Exception.Message)"
        Write-Error $errorMessage # This makes it an error object the script can see
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode.Value__
            Write-Host "Status Code: $statusCode" -ForegroundColor DarkRed
            try {
                $errorResponseStream = $_.Exception.Response.GetResponseStream()
                $streamReader = New-Object System.IO.StreamReader($errorResponseStream)
                $errorBodyContent = $streamReader.ReadToEnd()
                Write-Host "Error Response Body: $errorBodyContent" -ForegroundColor DarkGray
                $streamReader.Dispose(); $errorResponseStream.Dispose()
            } catch { Write-Host "Could not read error response body." -ForegroundColor DarkGray }
        }
        return $null # Indicate failure
    }
}

# --- Test Data Ensurance Functions ---

Function Ensure-TestArticles {
    param ([int]$DesiredCount = 3)
    Write-Host "`n== Ensuring Test Articles (Target: $DesiredCount highscore-eligible articles) ==" -ForegroundColor Yellow
    $existingArticlesResponse = Invoke-ApiRequest -Uri "$Global:BaseUrl/articles?limit=200&includeInactive=true"
    $Global:AllFetchedArticles = if ($existingArticlesResponse -and $existingArticlesResponse.articles) { $existingArticlesResponse.articles } else { @() }

    $highscoreEligibleArticles = $Global:AllFetchedArticles | Where-Object {
        ($_.countsForHighscore -is [bool] -and $_.countsForHighscore -eq $true -or "$($_.countsForHighscore)".ToLower() -eq 'true') -and
        ($_.active -is [bool] -and $_.active -eq $true -or "$($_.active)".ToLower() -eq 'true')
    }

    $missingCount = $DesiredCount - $highscoreEligibleArticles.Count
    $createdArticlesThisRun = @() # Articles created in this specific run

    if ($missingCount -gt 0) {
        Write-Host "Need to create $missingCount highscore-eligible articles." -ForegroundColor Yellow
        For ($i = 1; $i -le $missingCount; $i++) {
            $articleName = "Test Highscore Article $($Random = Get-Random -Minimum 1000 -Maximum 9999) - $i"
            $articlePayload = @{
                name                 = $articleName
                price                = [Math]::Round(((Get-Random -Minimum 5.0 -Maximum 30.0) + (Get-Random -Minimum 0.01 -Maximum 0.99)), 2) # Lower prices
                initialStock         = (Get-Random -Minimum 50 -Maximum 200)
                minStock             = 10
                unit                 = "Stk"
                category             = "Testartikel"
                countsForHighscore   = $true
                active               = $true
            } | ConvertTo-Json -Depth 3

            $newArticle = Invoke-ApiRequest -Uri "$Global:BaseUrl/articles" -Method Post -Body $articlePayload
            if ($newArticle -and $newArticle.id) {
                Write-Host "Article '$($newArticle.name)' created successfully with ID: $($newArticle.id)." -ForegroundColor Green
                $createdArticlesThisRun += $newArticle
            } else { Write-Warning "Failed to create test article '$articleName'." }
        }
    }

    $Global:TestHighscoreArticles = $highscoreEligibleArticles + $createdArticlesThisRun
    if ($Global:TestHighscoreArticles.Count -lt $DesiredCount) {
        Write-Warning "Could not ensure $DesiredCount highscore-eligible articles. Available: $($Global:TestHighscoreArticles.Count)."
        if ($Global:TestHighscoreArticles.Count -eq 0) { return $false }
    } else { Write-Host "Successfully ensured $($Global:TestHighscoreArticles.Count) highscore-eligible articles." -ForegroundColor Green }
    return $true
}

Function Ensure-TestCustomers {
    param ([int]$DesiredCount = 3)
    Write-Host "`n== Ensuring Test Customers (Target: $DesiredCount customers) ==" -ForegroundColor Yellow
    $existingCustomersResponse = Invoke-ApiRequest -Uri "$Global:BaseUrl/customers?limit=100"
    $Global:AllFetchedCustomers = if ($existingCustomersResponse -and $existingCustomersResponse.customers) { $existingCustomersResponse.customers } else { @() }

    $missingCount = $DesiredCount - $Global:AllFetchedCustomers.Count
    $createdCustomersThisRun = @()

    if ($missingCount -gt 0) {
        Write-Host "Need to create $missingCount customers." -ForegroundColor Yellow
        For ($i = 1; $i -le $missingCount; $i++) {
            $customerName = "Test Customer $($RandomName = (Get-Random -InputObject "Alpha","Bravo","Charlie","Delta","Echo")) $($RandomNum = Get-Random -Minimum 100 -Maximum 999)"
            $customerEmail = "test.customer.$($RandomNum)_$i@example.com"
            $customerPayload = @{
                name     = $customerName
                email    = $customerEmail
                balance  = (Get-Random -Minimum 500 -Maximum 1000) # << INCREASED BALANCE SIGNIFICANTLY
            } | ConvertTo-Json -Depth 3

            $newCustomer = Invoke-ApiRequest -Uri "$Global:BaseUrl/customers" -Method Post -Body $customerPayload
            if ($newCustomer -and $newCustomer.id) {
                Write-Host "Customer '$($newCustomer.name)' created successfully with ID: $($newCustomer.id)." -ForegroundColor Green
                $createdCustomersThisRun += $newCustomer
            } else { Write-Warning "Failed to create test customer '$customerName'." }
        }
    }
    $Global:TestCustomers = $Global:AllFetchedCustomers + $createdCustomersThisRun
     if ($Global:TestCustomers.Count -lt $DesiredCount) {
        Write-Warning "Could not ensure $DesiredCount customers. Available: $($Global:TestCustomers.Count)."
        if ($Global:TestCustomers.Count -eq 0) { return $false }
    } else { Write-Host "Successfully ensured $($Global:TestCustomers.Count) customers for testing." -ForegroundColor Green }
    return $true
}

# --- Test Scenario Functions ---

Function Test-CreateHighscoreTransactions {
    Write-Host "`n== Test Scenario: Create Highscore-Populating Transactions ==" -ForegroundColor Yellow
    if ($Global:TestHighscoreArticles.Count -lt 1) { Write-Warning "Skipping: Not enough verified highscore articles."; return }
    if ($Global:TestCustomers.Count -lt 1) { Write-Warning "Skipping customer sales: Not enough verified customers." }

    $customersToUse = $Global:TestCustomers | Get-Random -Count ([System.Math]::Min($Global:TestCustomers.Count, 3))
    $articlesToUse = $Global:TestHighscoreArticles | Get-Random -Count ([System.Math]::Min($Global:TestHighscoreArticles.Count, 3))

    # Transaction 1: Customer 1, Article 1, Large quantity
    if ($customersToUse.Count -gt 0 -and $articlesToUse.Count -gt 0) {
        $customer1 = $customersToUse[0]
        $article1 = $articlesToUse[0]
        $qty1 = Get-Random -Minimum 3 -Maximum 7 # Adjusted quantity slightly
        Write-Host "Attempting ACCOUNT sale for: $($customer1.name) (Balance: $($customer1.balance)) with article '$($article1.name)' (Price: $($article1.price)) (Qty: $qty1)" -ForegroundColor Cyan
        $estimatedTotal1 = $qty1 * $article1.price
        Write-Host "Estimated total for sale 1: $estimatedTotal1" -ForegroundColor DarkCyan
        $body1 = @{ paymentMethod = "ACCOUNT"; customerId = $customer1.id; items = @(@{ articleId = $article1.id; quantity = $qty1 }) } | ConvertTo-Json -Depth 3
        $sale1 = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions" -Method Post -Body $body1
        if ($sale1 -and $sale1.transaction) { Write-Host "Sale 1 for $($customer1.name) successful. Amount: $($sale1.transaction.totalAmount)" -ForegroundColor Green }
        elseif ($sale1 -eq $null) { Write-Warning "Sale 1 for $($customer1.name) failed (API call returned null or error)." }
    }

    # Transaction 2: Customer 2 (if exists), Article 2 (if exists), Medium quantity
    if ($customersToUse.Count -gt 1 -and $articlesToUse.Count -gt 1) {
        $customer2 = $customersToUse[1]
        $article2 = $articlesToUse[1]
        $qty2 = Get-Random -Minimum 2 -Maximum 4 # Adjusted quantity slightly
        Write-Host "Attempting ACCOUNT sale for: $($customer2.name) (Balance: $($customer2.balance)) with article '$($article2.name)' (Price: $($article2.price)) (Qty: $qty2)" -ForegroundColor Cyan
        $estimatedTotal2 = $qty2 * $article2.price
        Write-Host "Estimated total for sale 2: $estimatedTotal2" -ForegroundColor DarkCyan
        $body2 = @{ paymentMethod = "ACCOUNT"; customerId = $customer2.id; items = @(@{ articleId = $article2.id; quantity = $qty2 }) } | ConvertTo-Json -Depth 3
        $sale2 = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions" -Method Post -Body $body2
        if ($sale2 -and $sale2.transaction) { Write-Host "Sale 2 for $($customer2.name) successful. Amount: $($sale2.transaction.totalAmount)" -ForegroundColor Green }
        elseif ($sale2 -eq $null) { Write-Warning "Sale 2 for $($customer2.name) failed (API call returned null or error)." }
    }

    # Transaction 3: Cash Sale, Article (any highscore one), different quantity
    if ($articlesToUse.Count -gt 0) {
        $article3 = $articlesToUse | Get-Random
        $qty3 = Get-Random -Minimum 3 -Maximum 8
        Write-Host "Attempting CASH sale with article '$($article3.name)' (Price: $($article3.price)) (Qty: $qty3)" -ForegroundColor Cyan
        $body3 = @{ paymentMethod = "CASH"; items = @(@{ articleId = $article3.id; quantity = $qty3 }) } | ConvertTo-Json -Depth 3
        $sale3 = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions" -Method Post -Body $body3
        if ($sale3 -and $sale3.transaction) {
            Write-Host "Cash Sale 3 successful. Amount: $($sale3.transaction.totalAmount)" -ForegroundColor Green
            $Global:LastCashSaleId = $sale3.transaction.id
        }
        elseif ($sale3 -eq $null) { Write-Warning "Cash Sale 3 failed (API call returned null or error)." }
    }
}

Function Test-QuickSale {
    Write-Host "`n== Test Scenario: Quick Sale ==" -ForegroundColor Yellow
    if ($Global:TestHighscoreArticles.Count -eq 0) { Write-Warning "Skipping Quick Sale: No highscore articles."; return }
    $quickSaleArticle = $Global:TestHighscoreArticles | Get-Random
    $qty = Get-Random -Minimum 1 -Maximum 3
    Write-Host "Attempting Quick Sale for article '$($quickSaleArticle.name)' (Price: $($quickSaleArticle.price)) (Qty: $qty)" -ForegroundColor Cyan
    $body = @{ articleId = $quickSaleArticle.id; quantity = $qty; paymentMethod = "CASH" } | ConvertTo-Json
    $quickSale = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions/quick-sale" -Method Post -Body $body
    if ($quickSale -and $quickSale.transaction) { Write-Host "Quick Sale successful. Amount: $($quickSale.transaction.totalAmount)" -ForegroundColor Green }
    elseif ($quickSale -eq $null) { Write-Warning "Quick Sale failed." }
}

Function Test-CancelTransaction {
    param ([string]$TransactionId)
    Write-Host "`n== Test Scenario: Cancel Transaction ==" -ForegroundColor Yellow
    if (-not $TransactionId) { Write-Warning "Skipping Cancel Transaction: No Transaction ID."; return }
    Write-Host "Attempting to cancel transaction ID: $TransactionId" -ForegroundColor Cyan
    $cancelled = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions/$TransactionId/cancel" -Method Post
    if ($cancelled) { Write-Host "Transaction $TransactionId cancellation API call reported success (inspect response for details)." -ForegroundColor Green }
    elseif ($cancelled -eq $null) { Write-Warning "Transaction $TransactionId cancellation failed." }
}

Function Test-VerifyHighscore {
    Write-Host "`n== Test Scenario: Verify Highscore ==" -ForegroundColor Yellow
    $highscore = Invoke-ApiRequest -Uri "$Global:BaseUrl/highscores" # Assuming this endpoint exists
    if ($highscore) {
        Write-Host "Daily Amount Highscore Entries (Top 3 from response):" -ForegroundColor Cyan
        if ($highscore.daily -and $highscore.daily.amount -and $highscore.daily.amount.entries) {
            $highscore.daily.amount.entries | Select-Object -First 3 | Format-Table -AutoSize
        } else {
            Write-Warning "Highscore data structure not as expected, or no entries. Raw response:"
            $highscore | ConvertTo-Json -Depth 5
        }
    } else { Write-Warning "Could not retrieve highscore data (endpoint might be missing or 404)." }
    Read-Host "Highscore verification step. Press Enter to continue..."
}

Function Test-DailySummary {
    Write-Host "`n== Test Scenario: Daily Summary ==" -ForegroundColor Yellow
    $summaryResponse = Invoke-ApiRequest -Uri "$Global:BaseUrl/transactions/daily-summary"
    if ($summaryResponse -and $summaryResponse.summary) {
        $summary = $summaryResponse.summary
        Write-Host "Daily Summary for $($summaryResponse.date):" -ForegroundColor Cyan
        Write-Host "  - Total Revenue: $($summary.totalRevenue)"
        Write-Host "  - Total Transactions: $($summary.totalTransactions)"
        Write-Host "  - Cash Revenue: $($summary.cashRevenue)"
        Write-Host "  - Account Revenue: $($summary.accountRevenue)"
    } else { Write-Warning "Failed to retrieve or parse daily summary." }
}

# --- Main Script Execution ---
Write-Host "======== Clubtouch3 Transaction Test Script v3.1 (Increased Balance & Debug) ========" -ForegroundColor Magenta

# 1. Login
if (-not (Login-App -Email $Global:AdminEmail -Password $Global:AdminPassword)) {
    Write-Error "Critical Error: Login Failed. Aborting script."
    exit 1
}

# 2. Ensure Test Data (Articles & Customers)
if (-not (Ensure-TestArticles -DesiredCount 3)) {
    Write-Error "Critical Error: Failed to ensure enough highscore articles. Aborting."
    exit 1
}
if (-not (Ensure-TestCustomers -DesiredCount 3)) {
    Write-Warning "Warning: Failed to ensure enough customers. Some tests might be limited."
    # Decide if this is critical enough to exit
}

# 3. Run Test Scenarios
Test-CreateHighscoreTransactions
Test-QuickSale

Test-VerifyHighscore # Pause/check highscore

if ($Global:LastCashSaleId) {
    Test-CancelTransaction -TransactionId $Global:LastCashSaleId
} else {
    Write-Warning "No transaction ID in `$Global:LastCashSaleId for specific cancellation test."
}

Test-DailySummary

Write-Host "`n======== Test Script Execution Finished ========" -ForegroundColor Magenta