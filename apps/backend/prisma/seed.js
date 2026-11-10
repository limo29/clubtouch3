// Grundausstattung einer frischen ClubTouch3-Datenbank. Beliebig oft ausführbar, überschreibt nichts.
//
//   1. Erster Admin – nur wenn es noch gar keinen Benutzer gibt.
//      Lokal: admin@clubtouch3.local / Admin123!
//      Produktion (NODE_ENV=production): SEED_ADMIN_EMAIL und SEED_ADMIN_PASSWORD (min. 8 Zeichen) sind Pflicht,
//      es gibt dort kein Standardpasswort.
//   2. Standard-Artikelkatalog des Clubraums (prisma/seed-assets/articles.json, Stand der Übernahme aus
//      Clubtouch 2.0) mit Etikettbildern aus prisma/seed-assets/articles/. Bestand 0, fehlende Artikel werden
//      angelegt, vorhandene (gleicher Name, Groß-/Kleinschreibung egal) bleiben unverändert.
//   3. Reihenfolge der Kategorien – nur wenn noch keine gespeichert ist.
//
// Kunden und Guthaben gehören nicht hierher (personenbezogen): die kommen über das Übernahme-Werkzeug
// crtouch-migration, das dieselben Artikelnamen verwendet und die Artikel aus diesem Seed wiederfindet.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const ASSETS = path.join(__dirname, 'seed-assets');
const CATEGORY_ORDER_KEY = 'ARTICLE_CATEGORY_ORDER'; // wie in src/services/articleService.js

async function seedAdmin() {
  if (await prisma.user.count()) {
    console.log('Benutzer vorhanden – kein Admin angelegt.');
    return;
  }
  const production = process.env.NODE_ENV === 'production';
  const email = (process.env.SEED_ADMIN_EMAIL || (production ? '' : 'admin@clubtouch3.local')).trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || (production ? '' : 'Admin123!');
  if (!email || password.length < 8) {
    throw new Error('In Produktion braucht der Seed SEED_ADMIN_EMAIL und SEED_ADMIN_PASSWORD (mindestens 8 Zeichen).');
  }
  const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
  await prisma.user.create({
    data: { email, password: hash, name: process.env.SEED_ADMIN_NAME || 'Administrator', role: 'ADMIN', active: true },
  });
  console.log(`Admin angelegt: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log('Standardpasswort Admin123! – nach dem ersten Login ändern.');
}

async function seedArticles() {
  const { articles, categoryOrder } = JSON.parse(fs.readFileSync(path.join(ASSETS, 'articles.json'), 'utf8'));
  // Erst hier laden: der Dienst legt beim Laden die Upload-Ordner an (UPLOADS_DIR aus .env)
  const fileUploadService = require('../src/services/fileUploadService');
  await fileUploadService.ensureUploadDirs();

  const existing = new Set((await prisma.article.findMany({ select: { name: true } })).map((a) => a.name.trim().toLowerCase()));
  let created = 0;
  let images = 0;
  for (const a of articles) {
    if (existing.has(a.name.trim().toLowerCase())) continue;
    const data = {
      name: a.name,
      price: new Prisma.Decimal(a.price),
      stock: new Prisma.Decimal(0),
      minStock: new Prisma.Decimal(0),
      category: a.category,
      unit: a.unit || 'Flasche',
      purchaseUnit: a.purchaseUnit || 'Kiste',
      unitsPerPurchase: new Prisma.Decimal(a.unitsPerPurchase || 1),
      countsForHighscore: true,
    };
    const file = a.image && path.join(ASSETS, 'articles', a.image);
    if (file && fs.existsSync(file)) {
      try {
        const urls = await fileUploadService.processArticleImage({ buffer: fs.readFileSync(file) });
        Object.assign(data, {
          imageUrl: urls.original, imageThumbnail: urls.thumbnail, imageSmall: urls.small,
          imageMedium: urls.medium, imageLarge: urls.large,
        });
        images++;
      } catch (err) {
        console.warn(`Bild für ${a.name} nicht verarbeitet: ${err.message}`);
      }
    }
    await prisma.article.create({ data });
    created++;
  }
  console.log(`Artikel: ${created} angelegt (${images} mit Bild), ${articles.length - created} schon vorhanden.`);

  const order = await prisma.systemSetting.findUnique({ where: { key: CATEGORY_ORDER_KEY } });
  if (!order && Array.isArray(categoryOrder) && categoryOrder.length) {
    await prisma.systemSetting.create({
      data: { key: CATEGORY_ORDER_KEY, value: JSON.stringify(categoryOrder), description: 'Reihenfolge der Artikelkategorien' },
    });
    console.log(`Kategorie-Reihenfolge: ${categoryOrder.join(' · ')}`);
  }
}

async function main() {
  await seedAdmin();
  await seedArticles();
  console.log('Seed abgeschlossen.');
}

main()
  .catch((e) => {
    console.error('Seed-Fehler:', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
