// Zeitzone vor allen anderen Modulen festlegen: Der Geschäftstag beginnt um 06:00 LOKAL
// (utils/businessDay.js), Jahreswertung am 1.1. lokal. Railway/Docker laufen sonst in UTC,
// dann begänne der Tag im Sommer erst um 08:00.
process.env.TZ = process.env.TZ || 'Europe/Berlin';

require('dotenv').config();

// Pflicht-Umgebungsvariablen vor allem anderen prüfen (klare Meldung statt kryptischem Fehler später)
(function checkEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_EXPIRE_TIME', 'JWT_REFRESH_EXPIRE_TIME'];
  const missing = required.filter((k) => !process.env[k] || !String(process.env[k]).trim());
  if (missing.length) {
    console.error(`❌ Umgebungsvariablen fehlen: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    const placeholders = ['change-me', 'change-me-too'];
    for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = process.env[k];
      if (v.length < 32 || placeholders.includes(v) || v.startsWith('your-super-secret')) {
        console.error(`❌ ${k} ist zu kurz (mindestens 32 Zeichen) oder ein Platzhalter. Bitte einen zufälligen Wert setzen (z. B. openssl rand -hex 32).`);
        process.exit(1);
      }
    }
    if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
      console.warn('⚠️ JWT_SECRET und JWT_REFRESH_SECRET sind identisch, bitte unterschiedliche Werte verwenden.');
    }
    if (!process.env.PUBLIC_BALANCE_PIN) {
      console.warn('⚠️ PUBLIC_BALANCE_PIN ist nicht gesetzt, es gilt der Standard-PIN 666. Bitte einen eigenen PIN setzen.');
    }
  }
})();

const { app, prisma } = require('./app');
const { createServer } = require('http');
const { initializeWebSocket } = require('./utils/websocket');

const PORT = process.env.PORT || 8080;

let server;

async function main() {
  try {
    console.log('⏳ Connecting to database...');
    await prisma.$connect();
    console.log('✅ Database connection established');

    // Erstelle HTTP Server
    server = createServer(app);

    // Initialisiere WebSocket
    initializeWebSocket(server);
    console.log('✅ WebSocket-Server initialisiert');

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`📂 Working Directory: ${process.cwd()}`);
      // Clubscore: Ausgangsstand, Jahresarchiv, Timer auf den nächsten Geschäftstagsbeginn
      require('./services/highscoreService').init();
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();

// Graceful Shutdown (SIGINT lokal, SIGTERM durch Docker/Railway)
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n👋 ${signal}: Server wird heruntergefahren...`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try {
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve));
      // Offene Keep-Alive-/Socket.io-Verbindungen würden close() sonst blockieren
      if (server.closeAllConnections) server.closeAllConnections();
      await closed;
    }
    await prisma.$disconnect();
  } catch (e) {
    console.error('Fehler beim Herunterfahren:', e);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
