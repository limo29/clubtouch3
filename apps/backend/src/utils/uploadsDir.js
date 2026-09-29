// Ablageort aller Uploads (Artikelbilder, Belegnachweise, Werbung).
//
// Reihenfolge: UPLOADS_DIR (explizit) > RAILWAY_VOLUME_MOUNT_PATH (setzt Railway automatisch,
// sobald dem Service ein Volume angehängt ist) > <cwd>/uploads (lokal / Docker mit Bind-Mount).
//
// Ohne Volume liegen die Dateien im Container-Dateisystem und sind nach jedem Deploy weg,
// inklusive der Belegnachweise für die Kassenprüfung. Siehe railway.toml.
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(process.cwd(), 'uploads')
);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/** Absoluter Dateipfad → öffentliche URL "/uploads/…" (wie in der DB gespeichert) */
function toPublicUrl(absPath) {
  const rel = path.relative(UPLOADS_DIR, path.resolve(absPath)).replace(/\\/g, '/');
  return '/uploads/' + rel.replace(/^\/+/, '');
}

/** "/uploads/…", "http://host/uploads/…" oder "uploads/…" → absoluter Pfad unter UPLOADS_DIR */
function fromPublicUrl(urlOrPath) {
  let pathname = String(urlOrPath || '');
  if (/^https?:\/\//i.test(pathname)) {
    try { pathname = new URL(pathname).pathname; } catch { /* als Pfad weiterbehandeln */ }
  }
  const rel = pathname.replace(/^\/+/, '').replace(/^uploads\/?/, '');
  const abs = path.resolve(UPLOADS_DIR, rel);
  // Nie außerhalb des Upload-Ordners landen (z.B. "../")
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) {
    return path.join(UPLOADS_DIR, path.basename(rel));
  }
  return abs;
}

module.exports = { UPLOADS_DIR, toPublicUrl, fromPublicUrl };
