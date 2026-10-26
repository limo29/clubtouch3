# ClubTouch3

Webbasiertes Kassensystem für die Vereinsbar im Clubraum: Verkauf per Touch (Desktop, Tablet, Handy), Mitgliederkonten mit Guthaben, Lager, Einkauf mit Belegen, Kundenrechnungen, Kasse & Bank, Jahresabschluss für die Kassenprüfung, der Live-Highscore „Clubscore“ und Werbung für den Bildschirm im Clubraum.

Stand der Beschreibung: Oktober 2026. Technische Details für Entwickler stehen in [`CLAUDE.md`](CLAUDE.md).

## Funktionen

### Verkauf
- Artikel-Kacheln mit Kategorien und Suche; langes Tippen öffnet die Mengenauswahl, Warenkorb-Zeilen lassen sich wegwischen (mit „Rückgängig“).
- Bezahlt wird **bar**, **auf ein Mitgliedskonto** oder **„auf den Wirt“** (Eigenverbrauch ohne Umsatz). Konten dürfen bis 10 € überzogen werden (fest für alle).
- **Handy:** Die Artikel bleiben sichtbar, darunter eine Leiste „Wer zahlt?“ mit Warenkorb und Buchen-Knopf; Kundenwahl und Warenkorb öffnen sich von unten. Beim gewählten Kunden: Verlauf (mit Storno) und Guthaben aufladen.
- Nach jedem Verkauf 5 Sekunden „Rückgängig“: storniert den Verkauf und legt die Artikel zurück in den Warenkorb.
- Kundenliste: „Heute an der Theke“ (zuletzt aktiv zuerst) und alle Kunden alphabetisch.
- Offline: Verkäufe und Aufladungen werden zwischengespeichert und nachgebucht, sobald wieder Netz da ist.

### Kunden und Gruppen
- Mitglieder mit Spitzname, Guthaben, Verlauf, Kontoauszug (PDF) und optionalen Kontaktdaten (Anschrift, Telefon, E-Mail).
- Gruppen/Teams (z.B. „Panther“) mit Farbe, Emoji oder Bild; ein Gruppenkonto kann von vielen Mitgliedern genutzt werden.

### Artikel und Lager
- Preise, Kategorien, Bilder, Einkaufseinheit (z.B. Kiste = 20 Flaschen), Mindestbestand.
- Bestand wird durch Verkauf, Einkauf, Rechnungen, „Abgelaufen“ und „Auf den Wirt“ gebucht; negativer Bestand ist erlaubt (Warnung).

### Finanzen
- **Einkauf:** Lieferantenrechnungen und Lieferscheine mit Nachweis (Foto/PDF) und „Eingetragen von“ (vorbelegt mit dem Kontonamen, am Gemeinschafts-Tablet die Person auswählen); Lieferscheine lassen sich einer Rechnung zuordnen. Hat ein Mitglied privat bezahlt („Auslage“), wird der Betrag seinem Konto gutgeschrieben.
- **Kundenrechnungen:** Rechnungen an Mitglieder, Gäste oder Vereine mit PDF, Status und Zahlungsart.
- **Kasse & Bank:** Kassenzählung nach Scheinen und Münzen mit Soll/Ist, Kassenbewegungen (Einzahlung zur Bank, sonstige Einnahmen/Ausgaben), Bank-Abstimmung.
- **Kassenprüfung:** Geschäftsjahre mit geführtem Abschluss (Zeitraum, Kasse, Bank, Belege, Inventur, Prüfen), Belegliste als ZIP und Jahresabschluss-PDF.
- **Berichte:** Transaktionen, Inventur, Tagesabschluss, Monatsbericht, Kundenliste, Einnahmen & Ausgaben (EÜR), Kontoauszug, Kassenzählung.
- Der Geschäftstag beginnt um **6:00 Uhr**, damit die Nacht an der Bar ein Tag bleibt.

### Clubscore
- Tages- und Jahreswertung (Umsatz oder Anzahl), Teamwertung, Ziele mit Fortschrittsbalken, Meldungen wie „Neuer Spitzenreiter“.
- Interne Seite mit Einstellungen und Archiv; öffentliche Anzeige für den Fernseher (`/public/highscore`), live per WebSocket.

### Werbung
- Bilder, Videos oder im integrierten Editor gestaltete Slides (auch mit Getränkekarte); Anzeige im Vollbild unter `/public/ads`, Änderungen erscheinen sofort.

### Öffentliche Seiten (ohne Anmeldung)
| Seite | Zweck |
|---|---|
| `/public/highscore` | Clubscore für den Fernseher |
| `/public/ads` | Werbung/Slides für den Bildschirm |
| `/check-balance` | Mitglieder sehen ihr Guthaben und die letzten Buchungen – mit Name **und dem gemeinsamen PIN** (aushängen an der Theke) |

## Rollen

Es gibt drei Rollen. Die Oberfläche blendet aus, was eine Rolle nicht darf; verbindlich prüft das Backend.

| Bereich | Admin | Kassierer | Buchhaltung |
|---|:-:|:-:|:-:|
| Verkaufen, „Auf den Wirt“, Verkauf stornieren | ✅ | ✅ | – |
| Kunden anlegen/ändern, Guthaben aufladen und stornieren | ✅ | ✅ | nur lesen |
| Kontaktdaten der Kunden sehen und ändern | ✅ | ✅ | ✅ |
| Gruppen anlegen/ändern | ✅ | ✅ | nur lesen |
| Gruppen löschen | ✅ | – | – |
| Artikel anlegen, ändern, sortieren, „Abgelaufen“ buchen | ✅ | ✅ | nur lesen |
| Einkauf: Belege anlegen/ändern, Nachweis hochladen | ✅ | ✅ | nur lesen |
| Einkauf: bezahlt markieren, Lieferscheine zuordnen | ✅ | ✅ | ✅ |
| Einkauf: Belege löschen | ✅ | – | ✅ |
| Kundenrechnungen anlegen/ändern, Status, Storno | ✅ | ✅ | nur lesen + PDF |
| Rechnungs-Einstellungen (IBAN, Absender) | ✅ | – | – |
| Kasse zählen, Kassenbewegung buchen | ✅ | ✅ | ✅ |
| Kassenbewegung stornieren | ✅ | – | ✅ |
| EÜR, Bank-Abstimmung, Belege, Jahresabschluss ansehen | ✅ | ✅ | ✅ |
| Geschäftsjahr anlegen und abschließen | ✅ | – | ✅ |
| Berichte: Transaktionen, Inventur, Tagesabschluss, Kontoauszug | ✅ | ✅ | ✅ |
| Berichte: Kundenliste, Monatsbericht, EÜR | ✅ | – | ✅ |
| Clubscore: Ziele und Anzeige einstellen | ✅ | ✅ | – |
| Clubscore: Jahr zurücksetzen | ✅ | – | – |
| Werbung | ✅ | ✅ | – |
| Benutzer verwalten, fremde Passwörter setzen | ✅ | – | – |
| Eigenes Passwort ändern | ✅ | ✅ | ✅ |

Die Liste steht im Code an zwei Stellen und muss bei Änderungen in beiden angepasst werden: `authorize(...)` in `apps/backend/src/routes/*.js` und `apps/frontend/src/config/permissions.js`.

## Technik

- **Backend** (`apps/backend`): Node.js, Express 5, Prisma 6, PostgreSQL, Socket.io, PDFKit, sharp
- **Frontend** (`apps/frontend`): React 19 (Create React App), MUI 7, TanStack Query, React Router 7
- Node.js **22** (mindestens 20.9, wegen sharp)

## Lokal starten

Voraussetzungen: Node.js 22 und eine PostgreSQL-Datenbank.

1. **Backend** – `apps/backend/.env` anlegen (es gibt keine Vorlage im Ordner, Variablennamen siehe `docker/.env.example`):
   ```env
   DATABASE_URL=postgresql://USER:PASSWORT@localhost:5432/clubtouch3
   JWT_SECRET=<zufällige lange Zeichenkette>
   JWT_REFRESH_SECRET=<andere zufällige lange Zeichenkette>
   JWT_EXPIRE_TIME=15m
   JWT_REFRESH_EXPIRE_TIME=7d
   PORT=3001
   NODE_ENV=development
   ```
   `PORT=3001` ist wichtig: Das Frontend leitet `/api` dorthin weiter, ohne Angabe startet das Backend auf 8080.
   ```bash
   cd apps/backend
   npm install
   npm run prisma:migrate:deploy
   npm run prisma:seed      # legt admin@clubtouch3.local / Admin123! und Beispielartikel an
   npm run dev
   ```
2. **Frontend** (zweites Terminal):
   ```bash
   cd apps/frontend
   npm install
   npm start                # http://localhost:3000
   ```

Das Admin-Passwort aus dem Seed nach dem ersten Login ändern.

### Optionale Einstellungen (Backend)

| Variable | Zweck |
|---|---|
| `PUBLIC_BALANCE_PIN` | Gemeinsamer PIN für `/check-balance` (Standard `666`) |
| `FRONTEND_URL` | Erlaubte Herkunft für WebSockets in Produktion |
| `UPLOADS_DIR` | Ordner für Artikelbilder, Belegnachweise und Werbung |
| `INVOICE_IBAN`, `INVOICE_BIC`, `INVOICE_PAYEE_NAME`, `INVOICE_REF_PREFIX` | Angaben auf Kundenrechnungen |
| `BCRYPT_ROUNDS`, `EXPORT_DIR`, `PUBLIC_BASE_URL` | selten nötig |

## Docker

Siehe [`docker/readme.md`](docker/readme.md): `docker/manage.sh start` (Linux/Mac) bzw. `docker/manage.ps1 start` (Windows) startet Datenbank, Backend und Frontend.

## Betrieb auf Railway

`railway.toml` beschreibt zwei Dienste (Backend und Frontend mit nginx). Wichtig:
- **Volume** für das Backend unter `/app/uploads` anlegen, sonst sind Artikelbilder, Belegnachweise und Werbung nach jedem Deploy weg (Anleitung als Kommentar in `railway.toml`).
- `JWT_SECRET` und `JWT_REFRESH_SECRET` auf eigene zufällige Werte setzen.
- `PUBLIC_BALANCE_PIN` setzen, wenn nicht `666` gelten soll.
- `BACKEND_URL` im Frontend-Dienst auf die interne Backend-Adresse setzen.

## Projektstruktur

```
clubtouch3/
├── apps/
│   ├── backend/            Express-API, Prisma-Schema und Migrationen
│   │   └── src/            routes → controllers → services
│   └── frontend/           React-App
│       └── src/
│           ├── pages/      eine Datei je Seite
│           ├── components/ gemeinsame Bausteine (Artikel-Auswahl, Clubscore, Finanzen …)
│           └── config/     API-Pfade und Rollenrechte
├── docker/                 Docker-Compose und Verwaltungsskripte
├── docs/                   Audits und Recherchen
├── CLAUDE.md               technische Doku für Entwickler
└── railway.toml            Deployment
```

Gearbeitet wird auf den Branches `dev` / `public-dev`, gemergt nach `main` per Pull Request.
