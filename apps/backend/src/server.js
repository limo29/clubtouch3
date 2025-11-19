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

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`📂 Working Directory: ${process.cwd()}`);
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
