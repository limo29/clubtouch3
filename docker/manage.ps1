# Clubtouch3 Docker Management Script for Windows (updated for LAN-ready setup)

param(
    [string]$Command
)

$GREEN = "`e[32m"
$YELLOW = "`e[33m"
$RED = "`e[31m"
$NC = "`e[0m"

function Show-Help {
    Write-Host "Clubtouch3 Docker Management Script" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\manage.ps1 [command]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  start       - Start all services"
    Write-Host "  start-dev   - Start all services including Adminer"
    Write-Host "  stop        - Stop all services"
    Write-Host "  restart     - Restart all services"
    Write-Host "  rebuild     - Rebuild and start all services"
    Write-Host "  logs        - Show logs for all services"
    Write-Host "  logs-f      - Follow logs for all services"
    Write-Host "  status      - Show status of all services"
    Write-Host "  backup      - Create database backup"
    Write-Host "  clean       - Remove all containers and volumes"
    Write-Host "  help        - Show this help"
}

# Ensure .env exists
if (-not (Test-Path ".env")) {
    Write-Host "No .env file found. Creating from template..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env file. Please edit it with your configuration." -ForegroundColor Green
    } else {
        Write-Host "Missing .env.example template!" -ForegroundColor Red
    }
    exit 1
}

# Load .env values
$envData = Get-Content ".env" | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } |
    ForEach-Object {
        $parts = $_ -split '=', 2
        @{ Key = $parts[0].Trim(); Value = $parts[1].Trim() }
    }
$envVars = @{}
foreach ($pair in $envData) { $envVars[$pair.Key] = $pair.Value }

# Default display values
$lanHost = $envVars["PUBLIC_HOST"]
if (-not $lanHost) { $lanHost = "localhost" }

$webPort = $envVars["WEB_PORT"]
if (-not $webPort) { $webPort = "80" }

$apiPort = $envVars["API_PORT"]
if (-not $apiPort) { $apiPort = "3001" }


### NEU: Moderne CLI
$composeCmd = "docker compose"   # statt "docker-compose"

switch ($Command) {
    "start" {
        Write-Host "Starting Clubtouch3..." -ForegroundColor Green
        iex "$composeCmd up -d"
        Write-Host "✅ Clubtouch3 is running!" -ForegroundColor Green
        Write-Host "🌐 Frontend: http://$lanhost`:$webPort"
        Write-Host "🧠 Backend:  http://$layhost`:$apiPort"
        Write-Host "🐘 Database: $host:5432"
    }

    "start-dev" {
        Write-Host "Starting Clubtouch3 with Adminer (dev profile)..." -ForegroundColor Green
        iex "$composeCmd --profile dev up -d"
        Write-Host "✅ Clubtouch3 (dev) is running!" -ForegroundColor Green
        Write-Host "🌐 Frontend: http://$lanhost`:$webPort"
        Write-Host "🧠 Backend:  http://$lanhost`:$apiPort"
        Write-Host "🐘 Database: $host:5432"
        Write-Host "🧰 Adminer:  http://$lanhost:8080"
    }

    "stop" {
        Write-Host "Stopping Clubtouch3..." -ForegroundColor Yellow
        iex "$composeCmd down"
        Write-Host "✅ Stopped all services." -ForegroundColor Green
    }

    "restart" {
        Write-Host "Restarting Clubtouch3..." -ForegroundColor Yellow
        iex "$composeCmd restart"
        Write-Host "✅ Restarted." -ForegroundColor Green
    }

    "rebuild" {
        Write-Host "Rebuilding Clubtouch3 (no cache)..." -ForegroundColor Yellow
        iex "$composeCmd down"
        iex "$composeCmd build --no-cache"
        iex "$composeCmd up -d"
        Write-Host "✅ Rebuilt and started." -ForegroundColor Green
    }

    "logs" {
        iex "$composeCmd logs"
    }

    "logs-f" {
        iex "$composeCmd logs -f"
    }

    "status" {
        Write-Host "Clubtouch3 Status:" -ForegroundColor Green
        iex "$composeCmd ps"
    }

    "backup" {
        Write-Host "Creating database backup..." -ForegroundColor Green
        if (-not (Test-Path "backups")) { New-Item -ItemType Directory -Path "backups" | Out-Null }
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $dbUser = $envVars["DB_USER"]
        if (-not $dbUser) { $dbUser = "clubtouch3" }
        $dbName = $envVars["DB_NAME"]
        if (-not $dbName) { $dbName = "clubtouch3" }
        iex "$composeCmd exec -T db pg_dump -U $dbUser $dbName > backups\backup_$timestamp.sql"
        Write-Host "✅ Backup created: backups\backup_$timestamp.sql" -ForegroundColor Green
    }

    "clean" {
        Write-Host "This will remove ALL containers and volumes!" -ForegroundColor Red
        $confirm = Read-Host "Are you sure? (y/N)"
        if ($confirm -eq 'y') {
            iex "$composeCmd down -v"
            Write-Host "✅ All containers and volumes removed." -ForegroundColor Green
        } else {
            Write-Host "Cancelled." -ForegroundColor Yellow
        }
    }

    default {
        Show-Help
    }
}