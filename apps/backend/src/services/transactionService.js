const prisma = require('../utils/prisma');

class TransactionService {
  async createSale(data, userId) {
    const { customerId, paymentMethod, items, type = 'SALE' } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Keine Artikel im Warenkorb');
    }

    // DB-Transaktion
    const result = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const processedItems = [];
      const warnings = [];

      for (const item of items) {
        // Artikel laden
        const article = await tx.article.findUnique({
          where: { id: item.articleId }
        });

        if (!article) {
          throw new Error(`Artikel nicht gefunden: ${item.articleId}`);
        }
        if (!article.active) {
          throw new Error(`Artikel nicht verfügbar: ${article.name}`);
        }

        const qty = Number(item.quantity || 0);
        if (!(qty > 0)) {
          throw new Error(`Ungültige Menge für ${article.name}`);
        }

        // PREIS (als Number – pragmatisch, da Prisma Decimal in JS gut als Number nutzbar ist)
        const price = Number(article.price || 0);
        const itemTotal = price * qty;
        // Nur bei echtem Verkauf summieren wir den Betrag für die Bezahlung
        if (type === 'SALE') {
          totalAmount += itemTotal;
        }

        // Vorhersage Lager nach Verkauf (nur für Warnung, nicht blockierend)
        const currentStock = Number(article.stock || 0);
        const projected = currentStock - qty;
        if (projected < 0) {
          warnings.push(`Artikel "${article.name}" fällt auf ${projected}`);
        }

        // Lager reduzieren (darf negativ werden)
        await tx.article.update({
          where: { id: article.id },
          data: {
            stock: { decrement: qty }
          }
        });

        // StockMovement (SALE; Menge negativ)
        // Falls type EXPIRED oder OWNER_USE ist, nehmen wir das als Reason
        const movementType = (type === 'EXPIRED' || type === 'OWNER_USE') ? type : 'SALE';

        await tx.stockMovement.create({
          data: {
            articleId: article.id,
            type: movementType,
            quantity: -qty,
            reason: type === 'SALE' ? 'Verkauf' : (type === 'EXPIRED' ? 'Abgelaufen' : 'Eigenverbrauch')
          }
        });

        processedItems.push({
          articleId: article.id,
          quantity: qty,
          pricePerUnit: price,
          totalPrice: itemTotal,
          article // für Response/Debug
        });
      }

      // Kundenkonto-Prüfung (hier NICHT negativ zulassen!)
      // Nur relevant, wenn es ein SALE ist und per ACCOUNT bezahlt wird
      if (type === 'SALE' && paymentMethod === 'ACCOUNT' && customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: customerId }
        });
        if (!customer) throw new Error('Kunde nicht gefunden');
        const balance = Number(customer.balance || 0);
        const allowedOverdraft = 10.0;
        if (balance - totalAmount < -allowedOverdraft) {
          throw new Error(`Nicht genügend Guthaben. Limit: -€${allowedOverdraft.toFixed(2)}, Aktuell: €${balance.toFixed(2)}, Benötigt: €${totalAmount.toFixed(2)}`);
        }

        if (balance - totalAmount < 0) {
          warnings.push(`Achtung: Kontostand negativ! Neuer Stand: €${(balance - totalAmount).toFixed(2)}`);
        }

        await tx.customer.update({
          where: { id: customerId },
          data: { balance: { decrement: totalAmount } }
        });
      }

      // Transaktion anlegen
      const transaction = await tx.transaction.create({
        data: {
          type: type, // SALE, EXPIRED, OWNER_USE
          paymentMethod: (type === 'SALE') ? paymentMethod : 'CASH', // Fallback für Non-Sale
          totalAmount, // ist 0 bei EXPIRED/OWNER_USE
          userId,
          customerId,
          items: {
            create: processedItems.map(it => ({
              articleId: it.articleId,
              quantity: it.quantity,
              pricePerUnit: it.pricePerUnit,
              totalPrice: it.totalPrice
            }))
          }
        },
        include: {
          items: { include: { article: true } },
          customer: true,
          user: { select: { id: true, name: true } }
        }
      });

      // Optionale Audits für negative Bestände (best-effort, keine Blockade)
      for (const note of warnings) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'NEGATIVE_STOCK_WARNING',
            entityType: 'Transaction',
            entityId: transaction.id,
            changes: { message: note }
          }
        });
      }

      // WARNUNGEN kompatibel zurückgeben:
      // 1) als separates Array (für den neuen Controller),
      // 2) UND an das Objekt gehängt (für alten Controller).
      transaction._warnings = warnings;

      // UPDATE LAST ACTIVITY (immer, auch bei Barzahlung)
      if (customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: { lastActivity: new Date() }
        });
      }

      return { transaction, warnings };
    });

    // WebSocket Events + Highscore wie gehabt
    const { emitNewSale } = require('../utils/websocket');
    const highscoreService = require('./highscoreService');

    emitNewSale(result.transaction);
    highscoreService.updateAfterSale(result.transaction.id).catch(err => {
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
  async getDailySummary(date = new Date(), startHour = 6) {
    const requestDate = new Date(date);
    // Wenn die angefragte Zeit vor dem Tagesbeginn liegt (z.B. 1 Uhr nachts, Start 6 Uhr),
    // dann gehört das noch zum "Geschäftstag" von gestern.
    if (requestDate.getHours() < startHour) {
      requestDate.setDate(requestDate.getDate() - 1);
    }

    const startOfDay = new Date(requestDate);
    startOfDay.setHours(startHour, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setTime(endOfDay.getTime() - 1); // 1ms vor dem nächsten Start

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
      ORDER BY 
        CASE 
          WHEN EXTRACT(HOUR FROM "createdAt") < ${startHour} THEN EXTRACT(HOUR FROM "createdAt") + 24 
          ELSE EXTRACT(HOUR FROM "createdAt") 
        END
    `
    ]);

    function safeNumber(value) {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'bigint') return Number(value);
      return value;
    }

    return {
      date: date.toISOString().split('T')[0],
      startHour,
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
      topArticles: topArticles.map(a => ({ ...a, quantity_sold: safeNumber(a.quantity_sold), revenue: safeNumber(a.revenue) })),
      hourlyDistribution: hourlyDistribution.map(h => ({ hour: h.hour, transactions: safeNumber(h.transactions), revenue: safeNumber(h.revenue) }))
    };
  }

}

module.exports = new TransactionService();
