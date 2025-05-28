const prisma = require('../utils/prisma');
const customerService = require('./customerService');
const articleService = require('./articleService');

class TransactionService {
  // Erstelle neue Transaktion (Verkauf)
  async createSale(data, userId) {
    const { customerId, paymentMethod, items } = data;
    
    // Validiere Items
    if (!items || items.length === 0) {
      throw new Error('Keine Artikel im Warenkorb');
    }
    
    // Starte Datenbank-Transaktion
    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const processedItems = [];
      
      // Verarbeite jeden Artikel
      for (const item of items) {
        // Hole Artikel
        const article = await tx.article.findUnique({
          where: { id: item.articleId }
        });
        
        if (!article) {
          throw new Error(`Artikel nicht gefunden: ${item.articleId}`);
        }
        
        if (!article.active) {
          throw new Error(`Artikel nicht verfügbar: ${article.name}`);
        }
        
        // Prüfe Bestand
        if (article.stock < item.quantity) {
          throw new Error(`Nicht genügend Bestand für ${article.name}. Verfügbar: ${article.stock}`);
        }
        
        // Berechne Preis
        const itemTotal = article.price * item.quantity;
        totalAmount += itemTotal;
        
        // Reduziere Bestand
        await tx.article.update({
          where: { id: article.id },
          data: {
            stock: {
              decrement: item.quantity
            }
          }
        });
        
        // Erstelle Bestandsbewegung
        await tx.stockMovement.create({
          data: {
            articleId: article.id,
            type: 'SALE',
            quantity: -item.quantity,
            reason: 'Verkauf'
          }
        });
        
        processedItems.push({
          articleId: article.id,
          quantity: item.quantity,
          pricePerUnit: article.price,
          totalPrice: itemTotal,
          article // Für Response
        });
      }
      
      // Bei Kundenkonto-Zahlung: Prüfe und buche Guthaben ab
      if (paymentMethod === 'ACCOUNT' && customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: customerId }
        });
        
        if (!customer) {
          throw new Error('Kunde nicht gefunden');
        }
        
        if (customer.balance < totalAmount) {
          throw new Error(`Nicht genügend Guthaben. Verfügbar: €${customer.balance}, Benötigt: €${totalAmount}`);
        }
        
        // Buche Guthaben ab
        await tx.customer.update({
          where: { id: customerId },
          data: {
            balance: {
              decrement: totalAmount
            }
          }
        });
      }
      
      // Erstelle Transaktion
      const transaction = await tx.transaction.create({
        data: {
          type: 'SALE',
          paymentMethod,
          totalAmount,
          userId,
          customerId,
          items: {
            create: processedItems.map(item => ({
              articleId: item.articleId,
              quantity: item.quantity,
              pricePerUnit: item.pricePerUnit,
              totalPrice: item.totalPrice
            }))
          }
        },
        include: {
          items: {
            include: {
              article: true
            }
          },
          customer: true,
          user: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
      
      return transaction;
    });
    
        // In der createSale Methode, nach return result; hinzufügen:
        const { emitNewSale } = require('../utils/websocket');
        const highscoreService = require('./highscoreService');

        // Am Ende der createSale Methode:
        // Sende WebSocket Events
        emitNewSale(result);

        // Update Highscore asynchron
        highscoreService.updateAfterSale(result.id).catch(err => {
        console.error('Error updating highscore:', err);
        });
    return result;

  }
  
  // Storniere Transaktion
  async cancelTransaction(transactionId, userId) {
    // Starte Datenbank-Transaktion
    const result = await prisma.$transaction(async (tx) => {
      // Hole Original-Transaktion
      const originalTransaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: {
          items: true,
          customer: true
        }
      });
      
      if (!originalTransaction) {
        throw new Error('Transaktion nicht gefunden');
      }
      
      if (originalTransaction.cancelled) {
        throw new Error('Transaktion wurde bereits storniert');
      }
      
      // Markiere Original-Transaktion als storniert
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          cancelled: true,
          cancelledAt: new Date(),
          cancelledBy: userId
        }
      });
      
      // Erstelle Storno-Transaktion
      const cancelTransaction = await tx.transaction.create({
        data: {
          type: 'REFUND',
          paymentMethod: originalTransaction.paymentMethod,
          totalAmount: -originalTransaction.totalAmount,
          userId,
          customerId: originalTransaction.customerId,
          originalTransactionId: transactionId,
          items: {
            create: originalTransaction.items.map(item => ({
              articleId: item.articleId,
              quantity: -item.quantity,
              pricePerUnit: item.pricePerUnit,
              totalPrice: -item.totalPrice
            }))
          }
        }
      });
      
      // Gebe Artikel wieder in den Bestand zurück
      for (const item of originalTransaction.items) {
        await tx.article.update({
          where: { id: item.articleId },
          data: {
            stock: {
              increment: item.quantity
            }
          }
        });
        
        // Erstelle Bestandsbewegung
        await tx.stockMovement.create({
          data: {
            articleId: item.articleId,
            type: 'CORRECTION',
            quantity: item.quantity,
            reason: 'Storno'
          }
        });
      }
      
      // Bei Kundenkonto: Buche Guthaben zurück
      if (originalTransaction.paymentMethod === 'ACCOUNT' && originalTransaction.customerId) {
        await tx.customer.update({
          where: { id: originalTransaction.customerId },
          data: {
            balance: {
              increment: originalTransaction.totalAmount
            }
          }
        });
      }
      
      return {
        originalTransaction,
        cancelTransaction
      };
    });
    
    return result;
  }
  
  // Liste Transaktionen
  async listTransactions(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod, includeItems = false } = filters;
    
    const where = {};
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    
    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    
    const include = {
      customer: true,
      user: {
        select: {
          id: true,
          name: true
        }
      }
    };
    
    if (includeItems) {
      include.items = {
        include: {
          article: true
        }
      };
    }
    
    return await prisma.transaction.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' }
    });
  }
  
  // Hole einzelne Transaktion
  async getTransaction(transactionId) {
    return await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        items: {
          include: {
            article: true
          }
        },
        customer: true,
        user: {
          select: {
            id: true,
            name: true
          }
        },
        originalTransaction: {
          include: {
            items: true
          }
        },
        cancelledTransactions: {
          include: {
            items: true
          }
        }
      }
    });
  }
  
// Tagesabschluss
async getDailySummary(date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const [
    totalSales,
    cashSales,
    accountSales,
    cancelledSales,
    topArticles,
    hourlyDistribution
  ] = await Promise.all([
    // Gesamtumsatz
    prisma.transaction.aggregate({
      where: {
        type: 'SALE',
        cancelled: false,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      _sum: {
        totalAmount: true
      },
      _count: true
    }),
    
    // Bar-Umsatz
    prisma.transaction.aggregate({
      where: {
        type: 'SALE',
        paymentMethod: 'CASH',
        cancelled: false,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      _sum: {
        totalAmount: true
      },
      _count: true
    }),
    
    // Kundenkonto-Umsatz
    prisma.transaction.aggregate({
      where: {
        type: 'SALE',
        paymentMethod: 'ACCOUNT',
        cancelled: false,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      _sum: {
        totalAmount: true
      },
      _count: true
    }),
    
    // Stornierte Verkäufe
    prisma.transaction.aggregate({
      where: {
        type: 'SALE',
        cancelled: true,
        cancelledAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      _sum: {
        totalAmount: true
      },
      _count: true
    }),
    
    // Top verkaufte Artikel
    prisma.$queryRaw`
      SELECT 
        a.id,
        a.name,
        a.category,
        SUM(ti.quantity) as quantity_sold,
        SUM(ti."totalPrice") as revenue
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      JOIN "Article" a ON ti."articleId" = a.id
      WHERE t."createdAt" >= ${startOfDay}
        AND t."createdAt" <= ${endOfDay}
        AND t.cancelled = false
        AND t.type = 'SALE'
      GROUP BY a.id, a.name, a.category
      ORDER BY quantity_sold DESC
      LIMIT 10
    `,
    
    // Umsatzverteilung nach Stunden
    prisma.$queryRaw`
      SELECT 
        EXTRACT(HOUR FROM "createdAt") as hour,
        COUNT(*) as transactions,
        SUM("totalAmount") as revenue
      FROM "Transaction"
      WHERE "createdAt" >= ${startOfDay}
        AND "createdAt" <= ${endOfDay}
        AND cancelled = false
        AND type = 'SALE'
      GROUP BY hour
      ORDER BY hour
    `
  ]);
  
  function safeNumber(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'bigint') return Number(value);
    return value;
  }
  
  return {
    date: date.toISOString().split('T')[0],
    summary: {
      totalRevenue: safeNumber(totalSales._sum.totalAmount),
      totalTransactions: totalSales._count || 0,
      cashRevenue: safeNumber(cashSales._sum.totalAmount),
      cashTransactions: cashSales._count || 0,
      accountRevenue: safeNumber(accountSales._sum.totalAmount),
      accountTransactions: accountSales._count || 0,
      cancelledRevenue: safeNumber(cancelledSales._sum.totalAmount),
      cancelledTransactions: cancelledSales._count || 0
    },
    topArticles,
    hourlyDistribution
  };
}

}

module.exports = new TransactionService();
