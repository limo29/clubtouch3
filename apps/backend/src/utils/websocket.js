const { Server } = require('socket.io');
const { verifyAccessToken } = require('./auth');

let io;

function initializeWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || origin === 'null') {
          return callback(null, true);
        }

        // In development, allow all origins (e.g. LAN IPs)
        if (process.env.NODE_ENV === 'development') {
          return callback(null, true);
        }

        // In production, strictly check against allowed origin
        const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
        // Allow Railway domains, localhost, or exact match
        if (origin === allowedOrigin || (origin && origin.includes('railway.app')) || (origin && origin.includes('localhost'))) {
          callback(null, true);
        } else {
          console.warn('Blocked CORS origin:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true  // Nur setzen, wenn du wirklich Credentials benötigst
    }
  });


  // Authentifizierung für WebSocket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.userId}`);

    // User tritt dem Highscore-Raum bei
    socket.join('highscore');

    socket.on('disconnect', () => {
      console.log(`👋 User disconnected: ${socket.userId}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
}

// Highscore Update Event
function emitHighscoreUpdate(data) {
  if (io) {
    io.to('highscore').emit('highscore:update', data);
  }
}

// Neuer Verkauf Event
function emitNewSale(transaction) {
  if (io) {
    io.to('highscore').emit('sale:new', {
      transactionId: transaction.id,
      customerId: transaction.customerId,
      customerName: transaction.customer?.name,
      amount: transaction.totalAmount,
      timestamp: transaction.createdAt
    });
  }
}

module.exports = {
  initializeWebSocket,
  getIO,
  emitHighscoreUpdate,
  emitNewSale
};
