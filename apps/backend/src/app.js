const express = require('express');
const cors = require('cors');


// Route imports
const authRoutes = require('./routes/auth');

const prisma = require('./utils/prisma');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);

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

module.exports = { app, prisma };
