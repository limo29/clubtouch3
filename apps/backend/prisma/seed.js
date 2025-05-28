const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Check if admin exists
  const adminExists = await prisma.user.findUnique({
    where: { email: 'admin@clubtouch3.local' }
  });

  if (!adminExists) {
    // Create admin user
    const hashedPassword = await bcrypt.hash('Admin123!', 10);
    
    const admin = await prisma.user.create({
      data: {
        email: 'admin@clubtouch3.local',
        password: hashedPassword,
        name: 'System Administrator',
        role: 'ADMIN',
        active: true
      }
    });
    
    console.log('✅ Admin user created');
    console.log('📧 Email: admin@clubtouch3.local');
    console.log('🔑 Password: Admin123!');
    console.log('⚠️  Please change the password after first login!');
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  // Create sample categories if none exist
  const articleCount = await prisma.article.count();
  
  if (articleCount === 0) {
    console.log('📦 Creating sample articles...');
    
    const articles = await prisma.article.createMany({
      data: [
        {
          name: 'Club Mate',
          price: 2.50,
          stock: 48,
          minStock: 24,
          category: 'Getränke',
          unit: 'Flasche',
          countsForHighscore: true
        },
        {
          name: 'Bier (0.5l)',
          price: 3.00,
          stock: 50,
          minStock: 20,
          category: 'Getränke',
          unit: 'Glas',
          countsForHighscore: true
        },
        {
          name: 'Cola',
          price: 2.00,
          stock: 36,
          minStock: 12,
          category: 'Getränke',
          unit: 'Flasche',
          countsForHighscore: true
        },
        {
          name: 'Chips',
          price: 1.50,
          stock: 20,
          minStock: 10,
          category: 'Snacks',
          unit: 'Tüte',
          countsForHighscore: true
        },
        {
          name: 'Brezeln',
          price: 1.00,
          stock: 30,
          minStock: 15,
          category: 'Snacks',
          unit: 'Stück',
          countsForHighscore: true
        }
      ]
    });
    
    console.log('✅ Sample articles created');
  }

  console.log('🎉 Database seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
