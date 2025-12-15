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
const transactionRoutes = require('./routes/transactions');
const highscoreRoutes = require('./routes/highscore');
const exportRoutes = require('./routes/exports');
const invoiceRoutes = require('./routes/invoices');
const purchaseDocumentRoutes = require('./routes/purchaseDocuments');
const accountingRoutes = require('./routes/accountingRoutes');
const adRoutes = require('./routes/ads');
const publicRoutes = require('./routes/public');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const uploadsPath = path.join(process.cwd(), 'uploads');
const fs = require('fs');


// Ensure upload directory exists - just in case
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

console.log('📂 Serving uploads from:', uploadsPath);
app.use('/uploads', express.static(uploadsPath));
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/highscore', highscoreRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/purchase-documents', purchaseDocumentRoutes)
app.use('/api/accounting', accountingRoutes);
app.use('/api/highscore', require('./routes/highscore'));
app.use('/api/ads', adRoutes);
app.use('/api/public', publicRoutes);

// DEBUG ROUTE: List all files in uploads
app.get('/api/public/debug/files', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const uploadsDir = path.join(process.cwd(), 'uploads');

  const getFiles = (dir) => {
    const subdirs = fs.readdirSync(dir);
    const files = subdirs.map((subdir) => {
      const res = path.resolve(dir, subdir);
      return (fs.statSync(res).isDirectory()) ? getFiles(res) : res;
    });
    return files.reduce((a, f) => a.concat(f), []);
  };

  try {
    if (!fs.existsSync(uploadsDir)) {
      return res.json({ error: 'Uploads dir not found', path: uploadsDir });
    }
    const files = getFiles(uploadsDir);
    // Make paths relative to cwd for readability
    const relativeFiles = files.map(f => f.replace(process.cwd(), ''));
    res.json({ count: relativeFiles.length, files: relativeFiles });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});


// Basis-Route
app.get('/', (req, res) => {
  res.json({
    message: 'Clubtouch3 Backend läuft!',
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
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Etwas ist schiefgelaufen!',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
// Alle JSON-Antworten: BigInt/Decimal sicher serialisieren
app.set('json replacer', (_key, value) => {
  if (typeof value === 'bigint') return Number(value);            // oder String(value)
  if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
    // Prisma Decimal
    return value.toNumber();
  }
  return value;
});

module.exports = { app, prisma };
