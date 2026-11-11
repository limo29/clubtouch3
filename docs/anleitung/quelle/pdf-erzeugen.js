// Erzeugt docs/anleitung/ClubTouch-Benutzerhandbuch.pdf und ClubTouch-Schnellstart.pdf aus den HTML-Quellen hier.
// Die Quellen sind nur der Seiteninhalt (ab <title>), wie er als Artifact veröffentlicht wird; für den Druck bekommen
// sie hier ein minimales HTML-Gerüst. Gedruckt wird mit dem Druck-CSS der Seiten (A4, Hintergründe an, helles Schema).
//
// Aufruf (playwright-core und ein Chromium müssen vorhanden sein, sie sind bewusst keine Abhängigkeit des Repos):
//   NODE_PATH=<Ordner mit node_modules/playwright-core> node docs/anleitung/quelle/pdf-erzeugen.js
// Die Schriften (Barlow) kommen von Google Fonts, dafür braucht es Netz.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const HERE = __dirname;
const OUT = path.join(HERE, '..');
const DOCS = [
  ['handbuch.html', 'ClubTouch-Benutzerhandbuch.pdf'],
  ['schnellstart.html', 'ClubTouch-Schnellstart.pdf'],
];

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: 'light' });
    for (const [src, pdf] of DOCS) {
      const body = fs.readFileSync(path.join(HERE, src), 'utf8');
      const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><base href="file://${HERE}/"></head><body>${body}</body></html>`;
      const tmp = path.join(HERE, `.druck-${src}`);
      fs.writeFileSync(tmp, html);
      try {
        await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.pdf({ path: path.join(OUT, pdf), format: 'A4', printBackground: true, preferCSSPageSize: true });
        console.log('geschrieben:', pdf);
      } finally {
        fs.unlinkSync(tmp);
      }
    }
  } finally {
    await browser.close();
  }
})();
