require('dotenv').config(); 
const { app } = require('./app'); 
const prisma = require('./utils/prisma');
 
const PORT = process.env.PORT || 3001; 
 
async function main() { 
  try { 
    await prisma.$connect(); 
    console.log('✅ Datenbankverbindung hergestellt'); 
     
    app.listen(PORT, () => { 
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
