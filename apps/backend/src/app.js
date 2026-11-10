const express = require('express');
const cors = require('cors');
const prisma = require('./utils/prisma');
// Statische Dateien servieren
const path = require('path');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const articleRoutes = require('./routes/articles');
const customerRoutes = require('./routes/customers');
const customerGroupRoutes = require('./routes/customerGroups');
const transactionRoutes = require('./routes/transactions');
const highscoreRoutes = require('./routes/highscore');
const exportRoutes = require('./routes/exports');
const invoiceRoutes = require('./routes/invoices');
const purchaseDocumentRoutes = require('./routes/purchaseDocuments');
const accountingRoutes = require('./routes/accountingRoutes');
const adRoutes = require('./routes/ads');
const publicRoutes = require('./routes/public');
const cashCountRoutes = require('./routes/cashCounts');
const cashMovementRoutes = require('./routes/cashMovements');

const app = express();

// Hinter nginx/Railway steht die Client-IP in X-Forwarded-For. Nur private Proxys (Docker-Netz,
// Railway intern) sind vertrauenswürdig, sonst ließe sich die IP per Header fälschen. Ohne diese
// Einstellung sieht req.ip nur den Proxy und die Login-Bremse sperrt eine Kennung für alle.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Middleware
app.disable('x-powered-by');
app.use(cors());
// Werbe-Slides: JSON-Updates können Slide-Daten enthalten, dort großzügiges Limit (Uploads laufen über multer).
// Muss vor dem globalen Parser stehen, der bereits geparste Bodys überspringt.
app.use('/api/ads', express.json({ limit: '50mb' }));
// Sonst reichen kleine Bodys (Verkäufe, Belege, Jahresabschluss liegen weit darunter)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
const { UPLOADS_DIR: uploadsPath } = require('./utils/uploadsDir');
const fs = require('fs');


console.log('Serving uploads from:', uploadsPath);
// nosniff: Uploads nie anhand des Inhalts als HTML/Skript interpretieren lassen
app.use('/uploads', express.static(uploadsPath, {
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));
// Größenlimits der Datei-Uploads (siehe fileUploadService), nur für die Fehlermeldung
app.use('/api/purchase-documents', (req, res, next) => { req.uploadLimitMb = 10; next(); });
app.use('/api/articles', (req, res, next) => { req.uploadLimitMb = 5; next(); });
app.use('/api/customer-groups', (req, res, next) => { req.uploadLimitMb = 5; next(); });
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/customer-groups', customerGroupRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/highscore', highscoreRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/purchase-documents', purchaseDocumentRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/cash-counts', cashCountRoutes);
app.use('/api/cash-movements', cashMovementRoutes);



// Basis-Route
app.get('/', (req, res) => {
  res.json({
    message: 'Clubtouch3 Backend laeuft!',
    version: '1.0.0',
    timestamp: new Date()
  });
});

// Health Check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route nicht gefunden' });
});

// Error Handler
// Bekannte Upload-Fehler (multer, fileFilter) → 400 mit deutscher Meldung
const UPLOAD_FILTER_MESSAGES = /^(Nur JPEG, PNG und (PDF|WebP)|Nur Bilder und Videos)/;
function uploadErrorMessage(err) {
  if (err && err.name === 'MulterError') {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE': return 'Datei zu groß';
      case 'LIMIT_UNEXPECTED_FILE': return 'Unerwartetes Dateifeld im Upload';
      case 'LIMIT_FILE_COUNT': return 'Zu viele Dateien im Upload';
      default: return 'Upload fehlgeschlagen';
    }
  }
  if (err && UPLOAD_FILTER_MESSAGES.test(err.message || '')) return err.message;
  return null;
}
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Kein Stacktrace an den Client, in keinem Modus
  console.error(err.stack || err);
  const uploadMsg = uploadErrorMessage(err);
  if (uploadMsg) {
    // Größenlimit je Route: aus dem Fehlerkontext nicht ableitbar, daher über req.uploadLimitMb (optional)
    const msg = err.code === 'LIMIT_FILE_SIZE' && req.uploadLimitMb
      ? `Datei zu groß (maximal ${req.uploadLimitMb} MB)` : uploadMsg;
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Anfrage zu groß' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Ungültiges JSON im Anfragetext' });
  }
  const status = err.status || err.statusCode || 500;
  // Interne Fehlermeldungen (Prisma, Dateisystem …) nicht an den Client geben
  res.status(status).json({
    error: status < 500 && err.message ? err.message : 'Etwas ist schiefgelaufen!'
  });
});
// Alle JSON-Antworten: BigInt in Zahlen wandeln. Hinweis: Prisma Decimal hat toJSON() (liefert String) und
// erreicht den Replacer schon als String; der Zweig unten greift daher praktisch nicht. Das Frontend
// verlässt sich auf das Ist-Verhalten, deshalb nicht ändern.
app.set('json replacer', (_key, value) => {
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return value;
});

module.exports = { app, prisma };
