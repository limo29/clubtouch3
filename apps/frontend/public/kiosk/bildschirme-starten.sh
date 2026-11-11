#!/usr/bin/env bash
# ClubTouch: öffnet auf jedem angeschlossenen Monitor ein Fenster (Bildschirm 1, 2, 3 … von links nach rechts),
# Clubscore und Werbung im Vollbild, den Verkauf als normales maximiertes Fenster.
# Was auf welcher Nummer läuft, wird in der Kasse eingestellt: Werbung -> "Bildschirme".
# Aufruf: ./start-linux.sh [Adresse]     Beenden: Alt+F4 im jeweiligen Fenster.
# Zum Testen: BROWSER=<Pfad>, CLUBTOUCH_FLAGS="<weitere Browser-Schalter>", CLUBTOUCH_DEBUG_PORT=<Basis-Port>.
set -euo pipefail
ADRESSE="${1:-https://frontend-production-da0d.up.railway.app}"   # Adresse der Kasse, ohne Schrägstrich am Ende

# Browser: Umgebungsvariable BROWSER (Pfad) hat Vorrang, sonst der erste gefundene
BROWSER="${BROWSER:-}"
if [ -z "$BROWSER" ]; then
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
  done
fi
[ -n "$BROWSER" ] || { echo "Weder Chrome noch Chromium gefunden." >&2; exit 1; }
command -v xrandr >/dev/null 2>&1 || { echo "xrandr fehlt (Paket x11-xserver-utils)." >&2; exit 1; }

# Zeilen wie " 0: +*HDMI-1 1920/527x1080/296+1920+0  HDMI-1" -> "X Y", sortiert von links nach rechts
positionen() {
  sed -nE 's/^ *[0-9]+: .* [0-9]+\/[0-9]+x[0-9]+\/[0-9]+\+([0-9]+)\+([0-9]+) .*/\1 \2/p' | sort -n -k1,1 -k2,2
}

# Der Browser erwartet die Fensterposition in skalierten Pixeln, xrandr liefert echte Pixel.
# Der Faktor steht in Xft.dpi (96 = 100 %, 192 = 200 %); ohne Angabe gilt 1.
DPI=$(xrdb -query 2>/dev/null | sed -nE 's/^Xft\.dpi:[[:space:]]*([0-9]+).*/\1/p' | head -1)
DPI="${DPI:-96}"

# Belegung aus der Kasse: der Verkauf läuft als normales Fenster (daneben ist Platz für anderes, z. B. Musik),
# Clubscore und Werbung im Vollbild. Ist die Kasse nicht erreichbar, starten alle im Vollbild.
BELEGUNG=$(curl -fsS -m 8 "$ADRESSE/api/public/screens" 2>/dev/null || true)
inhalt() { printf '%s' "$BELEGUNG" | sed -nE "s/.*\"$1\":\"([a-z]+)\".*/\1/p"; }

nr=1
while read -r px py; do
  # Punkt 20 Pixel im Monitor statt genau auf der Kante: Rundung kann sonst den Nachbarmonitor treffen
  x=$(( (px + 20) * 96 / DPI ))
  y=$(( (py + 20) * 96 / DPI ))
  if [ "$(inhalt "$nr")" = "sales" ]; then MODUS="--start-maximized"; else MODUS="--kiosk"; fi
  # Eigenes Profil je Bildschirm: eigenes Vollbild-Fenster je Monitor, Anmeldung des Verkaufs bleibt erhalten.
  # --ozone-platform=x11: unter Wayland darf ein Programm sein Fenster sonst nicht selbst auf einen Monitor setzen.
  "$BROWSER" --user-data-dir="$HOME/.local/share/clubtouch/bildschirm$nr" \
    --ozone-platform=x11 \
    --app="$ADRESSE/screen/$nr" --window-position="$x,$y" $MODUS \
    --no-first-run --no-default-browser-check --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    ${CLUBTOUCH_DEBUG_PORT:+--remote-debugging-port=$((CLUBTOUCH_DEBUG_PORT + nr))} ${CLUBTOUCH_FLAGS:-} >/dev/null 2>&1 &
  sleep 0.8
  nr=$((nr + 1))
done < <(xrandr --listmonitors | positionen)
echo "$((nr - 1)) Bildschirm(e) gestartet."
