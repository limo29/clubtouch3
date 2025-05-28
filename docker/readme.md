# Clubtouch3 Docker Setup

## Schnellstart

1. **Konfiguration**
   ```bash
   cp .env.example .env
   # Bearbeite .env mit deinen Einstellungen
 
2.	Starten
# Linux/Mac
./manage.sh start

# Windows
.\manage.ps1 start
 
3.	Zugriff
a.	Frontend: http://localhost
b.	Backend API: http://localhost:3001
c.	Datenbank: localhost:5432
d.	Adminer (nur dev): http://localhost:8080
Befehle
Linux/Mac
./manage.sh start       # Alle Services starten
./manage.sh start-dev   # Mit Entwicklungstools starten
./manage.sh stop        # Alle Services stoppen
./manage.sh restart     # Alle Services neustarten
./manage.sh rebuild     # Neu bauen und starten
./manage.sh logs        # Logs anzeigen
./manage.sh logs-f      # Logs folgen
./manage.sh status      # Status anzeigen
./manage.sh backup      # Datenbank-Backup erstellen
./manage.sh clean       # Alles entfernen (Vorsicht!)
 
Windows
.\manage.ps1 start      # Alle Services starten
.\manage.ps1 start-dev  # Mit Entwicklungstools starten
.\manage.ps1 stop       # Alle Services stoppen
# ... (gleiche Befehle wie Linux/Mac)
 
Entwicklung
Lokale Entwicklung mit Docker
1.	Backend-Änderungen
docker-compose restart backend
 
2.	Frontend-Änderungen
docker-compose restart frontend
 
3.	Datenbank-Migrationen
docker-compose exec backend npx prisma migrate dev
 
Logs ansehen
# Alle Logs
docker-compose logs

# Nur Backend
docker-compose logs backend

# Nur Frontend
docker-compose logs frontend

# Live-Logs
docker-compose logs -f
 
Backup & Restore
Backup erstellen
./manage.sh backup
 
Backup wiederherstellen
./manage.sh restore backups/backup_20231201_120000.sql
 
Troubleshooting
Port bereits belegt
Ändere die Ports in der .env Datei oder stoppe andere Services.
Container startet nicht
docker-compose logs [service-name]
 
Datenbank-Verbindung fehlgeschlagen
Warte einige Sekunden nach dem Start. Die Datenbank braucht Zeit zum Initialisieren.
Kompletter Neustart
./manage.sh clean
./manage.sh start
 
Produktions-Deployment
1.	Sichere Passwörter in .env setzen
2.	SSL/TLS konfigurieren (nginx-proxy oder Traefik)
3.	Backup-Strategie implementieren
4.	Monitoring einrichten
Ressourcen-Anforderungen
•	Minimum: 2 CPU Cores, 2GB RAM
•	Empfohlen: 4 CPU Cores, 4GB RAM
•	Festplatte: 10GB für Datenbank und Backups ```
