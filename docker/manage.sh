#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Functions
print_help() {
    echo "Clubtouch3 Docker Management Script"
    echo ""
    echo "Usage: ./manage.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start       - Start all services"
    echo "  start-dev   - Start all services including dev tools"
    echo "  stop        - Stop all services"
    echo "  restart     - Restart all services"
    echo "  rebuild     - Rebuild and start all services"
    echo "  logs        - Show logs for all services"
    echo "  logs-f      - Follow logs for all services"
    echo "  status      - Show status of all services"
    echo "  backup      - Create database backup"
    echo "  restore     - Restore database from backup"
    echo "  clean       - Remove all containers and volumes"
    echo "  help        - Show this help"
}

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env file found. Creating from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}Created .env file. Please edit it with your configuration.${NC}"
    exit 1
fi

# Main script
case "$1" in
    start)
        echo -e "${GREEN}Starting Clubtouch3...${NC}"
        docker-compose up -d
        echo -e "${GREEN}Clubtouch3 is running!${NC}"
        echo "Frontend: http://localhost"
        echo "Backend: http://localhost:3001"
        echo "Database: localhost:5432"
        ;;
    
    start-dev)
        echo -e "${GREEN}Starting Clubtouch3 with dev tools...${NC}"
        docker-compose --profile dev up -d
        echo -e "${GREEN}Clubtouch3 is running with dev tools!${NC}"
        echo "Frontend: http://localhost"
        echo "Backend: http://localhost:3001"
        echo "Database: localhost:5432"
        echo "Adminer: http://localhost:8080"
        ;;
    
    stop)
        echo -e "${YELLOW}Stopping Clubtouch3...${NC}"
        docker-compose down
        echo -e "${GREEN}Clubtouch3 stopped.${NC}"
        ;;
    
    restart)
        echo -e "${YELLOW}Restarting Clubtouch3...${NC}"
        docker-compose restart
        echo -e "${GREEN}Clubtouch3 restarted.${NC}"
        ;;
    
    rebuild)
        echo -e "${YELLOW}Rebuilding Clubtouch3...${NC}"
        docker-compose down
        docker-compose build --no-cache
        docker-compose up -d
        echo -e "${GREEN}Clubtouch3 rebuilt and started.${NC}"
        ;;
    
    logs)
        docker-compose logs
        ;;
    
    logs-f)
        docker-compose logs -f
        ;;
    
    status)
        echo -e "${GREEN}Clubtouch3 Status:${NC}"
        docker-compose ps
        ;;
    
    backup)
        echo -e "${GREEN}Creating database backup...${NC}"
        mkdir -p backups
        docker-compose exec -T db pg_dump -U clubtouch3 clubtouch3 > backups/backup_$(date +%Y%m%d_%H%M%S).sql
        echo -e "${GREEN}Backup created in backups/ directory.${NC}"
        ;;
    
    restore)
        if [ -z "$2" ]; then
            echo -e "${RED}Please specify backup file to restore.${NC}"
            echo "Usage: ./manage.sh restore backups/backup_YYYYMMDD_HHMMSS.sql"
            exit 1
        fi
        
        if [ ! -f "$2" ]; then
            echo -e "${RED}Backup file not found: $2${NC}"
            exit 1
        fi
        
        echo -e "${YELLOW}Restoring database from $2...${NC}"
        docker-compose exec -T db psql -U clubtouch3 clubtouch3 < "$2"
        echo -e "${GREEN}Database restored.${NC}"
        ;;
    
    clean)
        echo -e "${RED}This will remove all containers and volumes!${NC}"
        read -p "Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker-compose down -v
            echo -e "${GREEN}All containers and volumes removed.${NC}"
        fi
        ;;
    
    help|*)
        print_help
        ;;
esac
