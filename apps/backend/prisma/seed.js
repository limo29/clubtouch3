const { PrismaClient, Prisma } = require('@prisma/client'); // Prisma importieren
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
    console.log('⚠️  Please change the password after first login!');
  } else {
    console.log('ℹ️  Admin user already exists');
  }

  // --- GEÄNDERT: Verwendet .create() mit Prisma.Decimal ---
  const articleCount = await prisma.article.count();
  
  if (articleCount === 0) {
    console.log('📦 Creating sample articles...');
    
    const sampleArticles = [
      {
          name: 'Club Mate',
          price: new Prisma.Decimal(2.50),
          stock: new Prisma.Decimal(48),
          minStock: new Prisma.Decimal(24),
          category: 'Getränke',
          unit: 'Flasche',
          purchaseUnit: 'Kiste',
          unitsPerPurchase: new Prisma.Decimal(20),
          countsForHighscore: true
        },
        {
          name: 'Bier (0.5l)',
          price: new Prisma.Decimal(3.00),
          stock: new Prisma.Decimal(50),
          minStock: new Prisma.Decimal(20),
          category: 'Getränke',
          unit: 'Glas',
          purchaseUnit: 'Kiste',
          unitsPerPurchase: new Prisma.Decimal(20),
          countsForHighscore: true
        },
        {
          name: 'Cola',
          price: new Prisma.Decimal(2.00),
          stock: new Prisma.Decimal(36),
          minStock: new Prisma.Decimal(12),
          category: 'Getränke',
          unit: 'Flasche',
          purchaseUnit: 'Kiste',
          unitsPerPurchase: new Prisma.Decimal(24),
          countsForHighscore: true
        },
        {
          name: 'Chips',
          price: new Prisma.Decimal(1.50),
          stock: new Prisma.Decimal(20),
          minStock: new Prisma.Decimal(10),
          category: 'Snacks',
          unit: 'Tüte',
          purchaseUnit: 'Karton',
          unitsPerPurchase: new Prisma.Decimal(10),
          countsForHighscore: true
        },
    ];

    // Wir verwenden .create() in einer Schleife statt .createMany()
    // um die Decimal-Typen sicher zu handhaben.
    for (const articleData of sampleArticles) {
      await prisma.article.create({ data: articleData });
    }
    
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
