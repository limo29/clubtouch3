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
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const { UPLOADS_DIR: uploadsPath } = require('./utils/uploadsDir');
const fs = require('fs');


console.log('Serving uploads from:', uploadsPath);
// nosniff: Uploads nie anhand des Inhalts als HTML/Skript interpretieren lassen
app.use('/uploads', express.static(uploadsPath, {
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));
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
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  // Interne Fehlermeldungen (Prisma, Dateisystem …) nicht an den Client geben
  res.status(status).json({
    error: status < 500 && err.message ? err.message : 'Etwas ist schiefgelaufen!',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
// Alle JSON-Antworten: BigInt/Decimal sicher serialisieren
app.set('json replacer', (_key, value) => {
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
    // Prisma Decimal
    return value.toNumber();
  }
  return value;
});

module.exports = { app, prisma };
