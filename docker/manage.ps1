# Clubtouch3 Docker Management Script for Windows

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
    Write-Host "  start-dev   - Start all services including dev tools"
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

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "No .env file found. Creating from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env file. Please edit it with your configuration." -ForegroundColor Green
    exit 1
}

# Main script
switch ($Command) {
    "start" {
        Write-Host "Starting Clubtouch3..." -ForegroundColor Green
        docker-compose up -d
        Write-Host "Clubtouch3 is running!" -ForegroundColor Green
        Write-Host "Frontend: http://localhost"
        Write-Host "Backend: http://localhost:3001"
        Write-Host "Database: localhost:5432"
    }
    
    "start-dev" {
        Write-Host "Starting Clubtouch3 with dev tools..." -ForegroundColor Green
        docker-compose --profile dev up -d
        Write-Host "Clubtouch3 is running with dev tools!" -ForegroundColor Green
        Write-Host "Frontend: http://localhost"
        Write-Host "Backend: http://localhost:3001"
        Write-Host "Database: localhost:5432"
        Write-Host "Adminer: http://localhost:8080"
    }
    
    "stop" {
        Write-Host "Stopping Clubtouch3..." -ForegroundColor Yellow
        docker-compose down
        Write-Host "Clubtouch3 stopped." -ForegroundColor Green
    }
    
    "restart" {
        Write-Host "Restarting Clubtouch3..." -ForegroundColor Yellow
        docker-compose restart
        Write-Host "Clubtouch3 restarted." -ForegroundColor Green
    }
    
    "rebuild" {
        Write-Host "Rebuilding Clubtouch3..." -ForegroundColor Yellow
        docker-compose down
        docker-compose build --no-cache
        docker-compose up -d
        Write-Host "Clubtouch3 rebuilt and started." -ForegroundColor Green
    }
    
    "logs" {
        docker-compose logs
    }
    
    "logs-f" {
        docker-compose logs -f
    }
    
    "status" {
        Write-Host "Clubtouch3 Status:" -ForegroundColor Green
        docker-compose ps
    }
    
    "backup" {
        Write-Host "Creating database backup..." -ForegroundColor Green
        if (-not (Test-Path "backups")) {
            New-Item -ItemType Directory -Path "backups"
        }
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        docker-compose exec -T db pg_dump -U clubtouch3 clubtouch3 > "backups\backup_$timestamp.sql"
        Write-Host "Backup created in backups\ directory." -ForegroundColor Green
    }
    
    "clean" {
        Write-Host "This will remove all containers and volumes!" -ForegroundColor Red
        $confirm = Read-Host "Are you sure? (y/N)"
        if ($confirm -eq 'y') {
            docker-compose down -v
            Write-Host "All containers and volumes removed." -ForegroundColor Green
        }
    }
    
    default {
        Show-Help
    }
}
