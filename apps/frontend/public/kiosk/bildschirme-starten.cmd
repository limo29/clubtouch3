<# : ClubTouch - Bildschirme starten
@echo off
rem Batch-Teil, fuer PowerShell ist alles bis zur schliessenden Kommentar-Klammer ein Kommentar.
rem Hier nur ASCII: cmd liest die Datei in der OEM-Codepage. Der PowerShell-Teil darunter wird als UTF-8 gelesen.
set "CT_DATEI=%~f0"
set "CT_ADRESSE=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText($env:CT_DATEI, [System.Text.Encoding]::UTF8))"
if errorlevel 1 pause
goto :eof
#>
# ClubTouch: öffnet auf jedem angeschlossenen Monitor ein Fenster (Bildschirm 1, 2, 3 … von links nach rechts),
# Clubscore und Werbung im Vollbild, den Verkauf als normales maximiertes Fenster.
# Was auf welcher Nummer läuft, wird in der Kasse eingestellt: Clubscore oder Werbung -> „Bildschirme“.
# Diese Datei lädt man dort herunter (die Adresse der Kasse ist dann schon eingetragen) und startet sie per Doppelklick.
# Sie ist Batch und PowerShell zugleich: cmd führt nur die Zeilen oben aus, die den Rest an PowerShell übergeben.
# Beenden: Alt+F4 im jeweiligen Fenster.

$Adresse = '__CLUBTOUCH_ADRESSE__'                    # beim Herunterladen eingesetzt, ohne Schrägstrich am Ende
if ($env:CT_ADRESSE) { $Adresse = $env:CT_ADRESSE }   # oder als Aufruf-Parameter: "Bildschirme starten.cmd" https://…
$Adresse = $Adresse.TrimEnd('/')

Add-Type -AssemblyName System.Windows.Forms
if ($Adresse -notmatch '^https?://') {
  [System.Windows.Forms.MessageBox]::Show("Keine Adresse der Kasse eingetragen. Bitte das Startskript in der Kasse unter Clubscore oder Werbung -> Bildschirme herunterladen.", "ClubTouch") | Out-Null
  exit 1
}

# Ohne das meldet Windows bei Skalierung (125 %, 150 %) falsche Monitor-Positionen
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class ClubTouchDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[ClubTouchDpi]::SetProcessDPIAware() | Out-Null
# Windows PowerShell 5.1 spricht von sich aus kein TLS 1.2, das die Kasse im Internet verlangt
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

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
