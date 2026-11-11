# Bildschirme mit einem Klick starten

Die Startskripte liegen nicht mehr hier, sondern unter `apps/frontend/public/kiosk/` und werden mit der Kasse
ausgeliefert. Herunterladen geht direkt in der Oberfläche: **Clubscore oder Werbung → Bildschirme → Schritt 2
„Am Thekenrechner starten“**. Beim Herunterladen setzt die Kasse ihre eigene Adresse ein, am PC muss nichts
mehr eingetragen werden.

| Datei im Repo | Download heißt | Start |
|---|---|---|
| `apps/frontend/public/kiosk/bildschirme-starten.cmd` | `Bildschirme starten.cmd` | Doppelklick (Windows, Chrome oder Edge) |
| `apps/frontend/public/kiosk/bildschirme-starten.sh` | `bildschirme-starten.sh` | `bash bildschirme-starten.sh` (Linux, Chrome/Chromium + `xrandr`, X11) |

Was die Skripte tun: Sie öffnen auf **jedem angeschlossenen Monitor** ein Fenster auf `/screen/1`, `/screen/2`, …
(von links nach rechts), jedes mit eigenem Browser-Profil. Clubscore und Werbung laufen im Kiosk-Vollbild, der
Verkauf als normales, maximiertes Fenster. Was auf welcher Nummer läuft, stellt man in der Kasse unter
**Bildschirme** ein; die Monitore schalten sofort um. Ob ein Fenster im Vollbild läuft, entscheidet die Belegung
beim Start des Skripts.

Autostart unter Windows: `Win+R` → `shell:startup` → Verknüpfung zu `Bildschirme starten.cmd` dort ablegen.

## Für Entwickler

- In den Dateien steht der Platzhalter `__CLUBTOUCH_ADRESSE__`; `components/display/kioskScripts.js` setzt beim
  Download `window.location.origin` ein und stellt die Zeilenenden um (CRLF für `.cmd`, LF für `.sh`).
  Ohne eingesetzte Adresse kann man sie als Parameter mitgeben: `bash bildschirme-starten.sh https://…` bzw.
  `"Bildschirme starten.cmd" https://…`.
- `bildschirme-starten.cmd` ist Batch und PowerShell in einer Datei: Die erste Zeile `<# : …` ist für cmd eine
  Sprungmarke (wird übersprungen), für PowerShell der Anfang eines Block-Kommentars. cmd führt nur den kurzen Batch-Teil aus,
  der die Datei als UTF-8 liest und an `powershell -ExecutionPolicy Bypass` übergibt. Den Batch-Teil nur in ASCII
  schreiben (cmd liest in der OEM-Codepage) und die Datei **ohne BOM** speichern (sonst stolpert cmd über die erste
  Zeile).
- Das Linux-Skript wurde an drei echten Monitoren getestet. Das Windows-Skript ist ungetestet (kein Windows-Rechner
  bei der Entwicklung).
