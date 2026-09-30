// Zeitzone vor allen anderen Modulen festlegen: Der Geschäftstag beginnt um 06:00 LOKAL
// (utils/businessDay.js), Jahreswertung am 1.1. lokal. Railway/Docker laufen sonst in UTC,
// dann begänne der Tag im Sommer erst um 08:00.
process.env.TZ = process.env.TZ || 'Europe/Berlin';

require('dotenv').config();
const { app, prisma } = require('./app');
const { createServer } = require('http');
const { initializeWebSocket } = require('./utils/websocket');

const PORT = process.env.PORT || 8080;

async function main() {
  try {
    console.log('⏳ Connecting to database...');
    await prisma.$connect();
    console.log('✅ Database connection established');

    // Erstelle HTTP Server
    const server = createServer(app);

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

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Server wird heruntergefahren...');
  await prisma.$disconnect();
  process.exit(0);
});
