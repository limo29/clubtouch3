// Startskripte für den Thekenrechner. Die einzige Quelle sind die Dateien unter public/kiosk/; beim Herunterladen
// wird dort die Adresse dieser Kasse eingesetzt, damit am PC nichts mehr eingetragen werden muss.
const PLACEHOLDER = '__CLUBTOUCH_ADRESSE__';

export const KIOSK_SCRIPTS = {
  windows: { source: 'bildschirme-starten.cmd', fileName: 'Bildschirme starten.cmd', eol: '\r\n' },
  linux: { source: 'bildschirme-starten.sh', fileName: 'bildschirme-starten.sh', eol: '\n' },
};

export const kioskOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');

/** Lädt die Vorlage, setzt die Adresse ein und bietet die Datei zum Speichern an. Wirft bei Fehlern. */
export async function downloadKioskScript(os) {
  const def = KIOSK_SCRIPTS[os];
  const res = await fetch(`${process.env.PUBLIC_URL || ''}/kiosk/${def.source}`, { cache: 'no-cache' });
  const text = res.ok ? await res.text() : '';
  // Ohne die Datei liefert der Server die App-Hülle (index.html) aus, die den Platzhalter nicht enthält
  if (!text.includes(PLACEHOLDER)) throw new Error('Startskript nicht gefunden');
  const body = text.split(PLACEHOLDER).join(kioskOrigin())
    .replace(/\r\n/g, '\n').replace(/\n/g, def.eol); // cmd braucht CRLF, bash LF
  const url = URL.createObjectURL(new Blob([body], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = def.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
