const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const { emitHighscoreUpdate } = require('../utils/websocket');

class HighscoreService {
  // Highscore-Einstellungen
  async getSettings() {
    // Später aus DB laden, erstmal Defaults
    return {
      dailyResetHour: 12, // 12:00 Uhr
      displayCount: 10, // Top 10
      countInactiveArticles: false,
      scoreMode: 'AMOUNT' // AMOUNT oder COUNT
    };
  }
  
  // Berechne aktuellen Highscore
  async calculateHighscore(type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    
    // Bestimme Zeitraum
    let startDate;
    const now = new Date();
    
    if (type === 'DAILY') {
      startDate = new Date();
      startDate.setHours(settings.dailyResetHour, 0, 0, 0);
      
      // Wenn es vor der Reset-Zeit ist, nehme gestern
      if (now < startDate) {
        startDate.setDate(startDate.getDate() - 1);
      }
    } else if (type === 'YEARLY') {
      startDate = new Date(now.getFullYear(), 0, 1); // 1. Januar
    }
    
    // Hole Artikel die zählen
    const countingArticles = await prisma.article.findMany({
      where: {
        countsForHighscore: true,
        ...(settings.countInactiveArticles ? {} : { active: true })
      },
      select: { id: true }
    });
    
    const articleIds = countingArticles.map(a => a.id);
    if (articleIds.length === 0) {
  // If no articles count towards the highscore,
  // return an empty highscore list or handle as appropriate.
        return {
          type,
          mode,
         startDate,
         entries: [], // Or calculate score without article filter if that's the logic
          lastUpdated: new Date()
         };
    }
    // Berechne Scores
    const scores = await prisma.$queryRaw`
      SELECT 
        c.id as customer_id,
        c.name as customer_name,
        c.nickname as customer_nickname,
        ${mode === 'AMOUNT' 
          ? Prisma.raw('SUM(ti."totalPrice")::decimal as score')
          : Prisma.raw('SUM(ti.quantity)::int as score')
        },
        COUNT(DISTINCT t.id) as transaction_count,
        ${mode === 'AMOUNT'
          ? Prisma.raw('SUM(ti.quantity)::int as total_items')
          : Prisma.raw('SUM(ti."totalPrice")::decimal as total_amount')
        }
      FROM "Customer" c
      JOIN "Transaction" t ON t."customerId" = c.id
      JOIN "TransactionItem" ti ON ti."transactionId" = t.id
      WHERE t."createdAt" >= ${startDate}
        AND t.cancelled = false
        AND t.type = 'SALE'
        AND ti."articleId" = ANY(${articleIds}::uuid[])
      GROUP BY c.id, c.name, c.nickname
      ORDER BY score DESC
      LIMIT ${settings.displayCount}
    `;
    
    // Formatiere Ergebnis
    const highscore = scores.map((entry, index) => ({
      rank: index + 1,
      customerId: entry.customer_id,
      customerName: entry.customer_name,
      customerNickname: entry.customer_nickname,
      score: Number(entry.score),
      transactionCount: Number(entry.transaction_count),
      ...(mode === 'AMOUNT' 
        ? { totalItems: Number(entry.total_items) }
        : { totalAmount: Number(entry.total_amount) }
      )
    }));
    
    return {
      type,
      mode,
      startDate,
      entries: highscore,
      lastUpdated: new Date()
    };
  }
  
  // Hole Highscore für bestimmten Kunden
  async getCustomerPosition(customerId, type = 'DAILY', mode = 'AMOUNT') {
    const settings = await this.getSettings();
    
    // Bestimme Zeitraum
    let startDate;
    const now = new Date();
    
    if (type === 'DAILY') {
      startDate = new Date();
      startDate.setHours(settings.dailyResetHour, 0, 0, 0);
      
      if (now < startDate) {
        startDate.setDate(startDate.getDate() - 1);
      }
    } else if (type === 'YEARLY') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }
    
    // Hole Artikel die zählen
    const countingArticles = await prisma.article.findMany({
      where: {
        countsForHighscore: true,
        ...(settings.countInactiveArticles ? {} : { active: true })
      },
      select: { id: true }
    });
    
    const articleIds = countingArticles.map(a => a.id);
    
    // Berechne Position
    const result = await prisma.$queryRaw`
      WITH customer_scores AS (
        SELECT 
          c.id,
          c.name,
          c.nickname,
          ${mode === 'AMOUNT' 
            ? Prisma.raw('SUM(ti."totalPrice")::decimal as score')
            : Prisma.raw('SUM(ti.quantity)::int as score')
          },
          RANK() OVER (ORDER BY ${mode === 'AMOUNT' 
            ? Prisma.raw('SUM(ti."totalPrice")')
            : Prisma.raw('SUM(ti.quantity)')
          } DESC) as rank
        FROM "Customer" c
        JOIN "Transaction" t ON t."customerId" = c.id
        JOIN "TransactionItem" ti ON ti."transactionId" = t.id
        WHERE t."createdAt" >= ${startDate}
          AND t.cancelled = false
          AND t.type = 'SALE'
          AND ti."articleId" = ANY(${articleIds}::uuid[])
        GROUP BY c.id, c.name, c.nickname
      )
      SELECT * FROM customer_scores WHERE id = ${customerId}
    `;
    
    if (result.length === 0) {
      return null;
    }
    
    return {
      customerId: result[0].id,
      customerName: result[0].name,
      customerNickname: result[0].nickname,
      score: Number(result[0].score),
      rank: Number(result[0].rank)
    };
  }
  
  // Update Highscore nach Verkauf
  async updateAfterSale(transactionId) {
    try {
      // Hole Transaktion
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: {
          customer: true,
          items: {
            include: {
              article: true
            }
          }
        }
      });
      
      if (!transaction || !transaction.customerId || transaction.cancelled) {
        return;
      }
      
      // Prüfe ob relevante Artikel dabei sind
      const hasRelevantArticles = transaction.items.some(
        item => item.article.countsForHighscore
      );
      
      if (!hasRelevantArticles) {
        return;
      }
      
      // Berechne neue Highscores
      const [dailyAmount, dailyCount, yearlyAmount, yearlyCount] = await Promise.all([
        this.calculateHighscore('DAILY', 'AMOUNT'),
        this.calculateHighscore('DAILY', 'COUNT'),
        this.calculateHighscore('YEARLY', 'AMOUNT'),
        this.calculateHighscore('YEARLY', 'COUNT')
      ]);
      
      // Hole Position des Kunden
      const [customerDailyAmount, customerDailyCount] = await Promise.all([
        this.getCustomerPosition(transaction.customerId, 'DAILY', 'AMOUNT'),
        this.getCustomerPosition(transaction.customerId, 'DAILY', 'COUNT')
      ]);
      
      // Sende Update via WebSocket
      emitHighscoreUpdate({
        daily: {
          amount: dailyAmount,
          count: dailyCount
        },
        yearly: {
          amount: yearlyAmount,
          count: yearlyCount
        },
        customerPosition: {
          customerId: transaction.customerId,
          daily: {
            amount: customerDailyAmount,
            count: customerDailyCount
          }
        }
      });
    } catch (error) {
      console.error('Error updating highscore:', error);
    }
  }
  
  // Reset Highscore
  async resetHighscore(type, userId) {
    if (type === 'DAILY') {
      // Tages-Highscore wird automatisch zurückgesetzt
      throw new Error('Tages-Highscore wird automatisch zurückgesetzt');
    }
    
    if (type === 'YEARLY') {
      // Erstelle Highscore-Snapshot für Archiv
      const currentHighscore = await this.calculateHighscore('YEARLY', 'AMOUNT');
      
      // Speichere in Audit-Log
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'RESET_YEARLY_HIGHSCORE',
          entityType: 'Highscore',
          entityId: 'yearly',
          changes: {
            archivedHighscore: currentHighscore
          }
        }
      });
      
      // Aktualisiere alle Highscore-Entries
      // (In der aktuellen Implementierung passiert das automatisch durch Zeitfilter)
      
      // Sende Update
      const newHighscores = await Promise.all([
        this.calculateHighscore('DAILY', 'AMOUNT'),
        this.calculateHighscore('DAILY', 'COUNT'),
        this.calculateHighscore('YEARLY', 'AMOUNT'),
        this.calculateHighscore('YEARLY', 'COUNT')
      ]);
      
      emitHighscoreUpdate({
        daily: {
          amount: newHighscores[0],
          count: newHighscores[1]
        },
        yearly: {
          amount: newHighscores[2],
          count: newHighscores[3]
        },
        reset: true,
        resetType: 'YEARLY'
      });
    }
  }
  
  // Hole Achievements/Badges für Kunden
  async getCustomerAchievements(customerId) {
    const achievements = [];
    
    // Prüfe verschiedene Achievements
    const [
      totalTransactions,
      totalSpent,
      favoriteArticle,
      dailyWins,
      yearlyWins
    ] = await Promise.all([
      // Anzahl Transaktionen
      prisma.transaction.count({
        where: {
          customerId,
          cancelled: false
        }
      }),
      
      // Gesamtausgaben
      prisma.transaction.aggregate({
        where: {
          customerId,
          cancelled: false
        },
        _sum: {
          totalAmount: true
        }
      }),
      
      // Lieblingsartikel
      prisma.$queryRaw`
        SELECT a.name, COUNT(*) as count
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId}
          AND t.cancelled = false
        GROUP BY a.id, a.name
        ORDER BY count DESC
        LIMIT 1
      `,
      
      // Tagessiege (vereinfacht - später erweitern)
      0,
      
      // Jahressiege (vereinfacht - später erweitern)
      0
    ]);
    
    // Vergebe Achievements
    if (totalTransactions >= 100) {
      achievements.push({
        id: 'century',
        name: 'Jahrhundert-Kunde',
        description: '100 Einkäufe getätigt',
        icon: '💯'
      });
    }
    
    if (totalTransactions >= 10) {
      achievements.push({
        id: 'regular',
        name: 'Stammkunde',
        description: '10 Einkäufe getätigt',
        icon: '⭐'
      });
    }
    
    if (totalSpent._sum.totalAmount >= 500) {
      achievements.push({
        id: 'big_spender',
        name: 'Großzügig',
        description: '500€ ausgegeben',
        icon: '💰'
      });
    }
    
    if (favoriteArticle.length > 0 && favoriteArticle[0].count >= 50) {
      achievements.push({
        id: 'loyal_fan',
        name: `${favoriteArticle[0].name}-Fan`,
        description: `50x ${favoriteArticle[0].name} gekauft`,
        icon: '❤️'
      });
    }
    
    return achievements;
  }
}

module.exports = new HighscoreService();
