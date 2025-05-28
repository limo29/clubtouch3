require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testConnection() {
  try {
    // Teste Verbindung
    await prisma.$connect();
    console.log('✅ Datenbankverbindung erfolgreich!');
    
    // Zähle User
    const userCount = await prisma.user.count();
    console.log(`📊 Anzahl User in DB: ${userCount}`);
    
    // Liste alle User
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true
      }
    });
    
    console.log('👥 User in der Datenbank:');
    users.forEach(user => {
      console.log(`  - ${user.email} (${user.role}) - Aktiv: ${user.active}`);
    });
    
  } catch (error) {
    console.error('❌ Datenbankfehler:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
