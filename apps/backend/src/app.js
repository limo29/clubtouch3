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
if (fs.existsSync(uploadsPath)) {
  console.log('📂 Serving uploads from:', uploadsPath);
  app.use('/uploads', express.static(uploadsPath));
} else {
  console.warn('⚠️ Uploads directory not found, skipping static serve:', uploadsPath);
}
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
