# ClubTouch: öffnet auf jedem angeschlossenen Monitor ein Fenster (Bildschirm 1, 2, 3 … von links nach rechts),
# Clubscore und Werbung im Vollbild, den Verkauf als normales maximiertes Fenster.
# Was auf welcher Nummer läuft, wird in der Kasse eingestellt: Werbung -> "Bildschirme".
# Start per Doppelklick auf "Bildschirme starten.bat". Beenden: Alt+F4 im jeweiligen Fenster.
# Die Datei ist UTF-8 mit BOM gespeichert, sonst liest Windows PowerShell 5.1 die Umlaute falsch.
param(
  [string]$Adresse = "https://frontend-production-da0d.up.railway.app"   # Adresse der Kasse, ohne Schrägstrich am Ende
)

Add-Type -AssemblyName System.Windows.Forms
# Ohne das meldet Windows bei Skalierung (125 %, 150 %) falsche Monitor-Positionen
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[Dpi]::SetProcessDPIAware() | Out-Null

$kandidaten = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $kandidaten | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) {
  [System.Windows.Forms.MessageBox]::Show("Weder Chrome noch Edge gefunden.", "ClubTouch") | Out-Null
  exit 1
}

# Monitore von links nach rechts (bei gleicher Position von oben nach unten)
$monitore = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y }
# Belegung aus der Kasse: der Verkauf läuft als normales Fenster (daneben ist Platz für anderes, z. B. Musik),
# Clubscore und Werbung im Vollbild. Ist die Kasse nicht erreichbar, starten alle im Vollbild.
$belegung = $null
try { $belegung = (Invoke-RestMethod -Uri "$Adresse/api/public/screens" -TimeoutSec 8).screens } catch { }

$nr = 1
foreach ($m in $monitore) {
  $inhalt = if ($belegung) { $belegung."$nr" } else { $null }
  $modus = if ($inhalt -eq "sales") { "--start-maximized" } else { "--kiosk" }
  # Eigenes Profil je Bildschirm: nur so öffnet der Browser wirklich ein eigenes Vollbild-Fenster je Monitor,
  # und die Anmeldung des Verkaufs-Bildschirms bleibt erhalten.
  $profil = Join-Path $env:LOCALAPPDATA "ClubTouch\Bildschirm$nr"
  $argumente = @(
    "--user-data-dir=`"$profil`"",
    "--app=$Adresse/screen/$nr",
    "--window-position=$($m.Bounds.X),$($m.Bounds.Y)",
    $modus,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--autoplay-policy=no-user-gesture-required"
  )
  Start-Process -FilePath $browser -ArgumentList $argumente
  Start-Sleep -Milliseconds 800
  $nr++
}
