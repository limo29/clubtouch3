require('dotenv').config();
const { app, prisma } = require('./app');
const { createServer } = require('http');
const { initializeWebSocket } = require('./utils/websocket');

const PORT = process.env.PORT || 8080;

async function main() {
  try {
    await prisma.$connect();
    console.log('✅ Datenbankverbindung hergestellt');

    // Erstelle HTTP Server
    const server = createServer(app);

    // Initialisiere WebSocket
    initializeWebSocket(server);
    console.log('✅ WebSocket-Server initialisiert');

    server.listen(PORT, () => {
      console.log(`🚀 Server läuft auf Port ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Fehler beim Serverstart:', error);
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
