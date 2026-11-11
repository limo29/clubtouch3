# Bildschirme mit einem Klick starten

Am Thekenrechner hängen mehrere Monitore (z. B. zwei über der Theke, einer für die Kasse).
Das Startskript öffnet auf **jedem angeschlossenen Monitor** ein Fenster – Clubscore und Werbung im Vollbild,
den Verkauf als normales, maximiertes Fenster (dort läuft oft noch etwas anderes, z. B. die Musik):

| Monitor (von links nach rechts) | Adresse |
|---|---|
| 1 | `…/screen/1` |
| 2 | `…/screen/2` |
| 3 | `…/screen/3` |

**Was auf welcher Nummer läuft**, stellt man in der Kasse ein: *Werbung → Bildschirme*
(Clubscore, Werbung, Verkauf oder nichts). Die Bildschirme schalten sofort um.
Wird ein Monitor oder Kabel getauscht, muss also nur dort die Zuordnung geändert werden.
„Nummern auf den Bildschirmen einblenden“ zeigt für 8 Sekunden, welcher Monitor welche Nummer hat.

## Windows

1. Ordner `scripts/kiosk` auf den Rechner kopieren.
2. Falls die Kasse unter einer anderen Adresse läuft: in `start-windows.ps1` oben `$Adresse` anpassen.
3. Doppelklick auf **`Bildschirme starten.bat`**. Für den Start beim Hochfahren eine Verknüpfung
   in den Autostart-Ordner legen (`Win+R` → `shell:startup`).

Gebraucht wird Chrome oder Edge. Beenden: `Alt+F4` im jeweiligen Fenster.

## Linux

```bash
./start-linux.sh                      # oder: ./start-linux.sh https://meine-kasse.example
```

Gebraucht werden Chrome oder Chromium und `xrandr` (X11).

## Gut zu wissen

- Ob ein Fenster im Vollbild startet, entscheidet die Belegung beim Start. Wird sie später umgestellt,
  wechselt der Inhalt sofort, die Fensterart erst beim nächsten Start des Skripts.
- Jeder Bildschirm hat ein eigenes Browser-Profil. Der Verkaufs-Bildschirm fragt beim ersten Start
  einmal nach der Anmeldung und bleibt danach angemeldet.
- Die Nummern richten sich nach der Anordnung der Monitore in den Anzeige-Einstellungen des
  Betriebssystems (links = 1).
- Clubscore und Werbung füllen jeden Monitor, auch wenn er nicht 16:9 ist. Folien sind für 16:9
  gebaut; auf anderen Formaten bleibt der Hintergrund der Folie bis zum Rand, der Inhalt mittig.
