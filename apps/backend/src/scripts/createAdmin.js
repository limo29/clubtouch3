require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../utils/auth');

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    const email = 'admin@clubtouch3.local';
    const password = 'Admin123!';
    const name = 'System Administrator';
    
    // Prüfe ob Admin bereits existiert
    const existing = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existing) {
      console.log('❌ Admin-User existiert bereits!');
      return;
    }
    
    // Erstelle Admin
    const hashedPassword = await hashPassword(password);
    
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        active: true
      }
    });
    
    console.log('✅ Admin-User erstellt!');
    console.log('📧 E-Mail:', email);
    console.log('🔑 Passwort:', password);
    console.log('⚠️  Bitte Passwort nach dem ersten Login ändern!');
    
  } catch (error) {
    console.error('❌ Fehler:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
