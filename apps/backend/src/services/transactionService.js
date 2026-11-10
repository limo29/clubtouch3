const prisma = require('../utils/prisma');
const { CUSTOMER_BASIC_SELECT } = require('../utils/customerSelect');
const {
  BUSINESS_DAY_START_HOUR,
  businessDayWindow,
  parseLocalDate,
  endOfLocalDay,
  formatLocalDate,
} = require('../utils/businessDay');
const { userError, isUniqueViolation } = require('../utils/httpError');
const { normalizeClientId, resolveClientCreatedAt } = require('../utils/clientRequest');
const closedPeriod = require('../utils/closedPeriod');

const TYPE_LABEL = { SALE: 'Verkauf', OWNER_USE: 'Buchung „Auf den Wirt“', EXPIRED: 'Buchung „Abgelaufen“' };
const PAY_LABEL = { CASH: 'bar', ACCOUNT: 'Kundenkonto', CARD: 'Karte' };
const saleLabel = (t, customer) => `${TYPE_LABEL[t.type] || t.type}${t.type === 'SALE' ? ` (${PAY_LABEL[t.paymentMethod] || t.paymentMethod})` : ''}`
  + `${customer ? ` von ${customer.nickname || customer.name}` : ''} vom ${closedPeriod.fmtDate(t.createdAt)} ${new Date(t.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

// Prisma speichert DateTime als "timestamp without time zone" in UTC. Stundenwerte für
// Berichte müssen in lokaler Zeit gruppiert werden, sonst steht im Tagesabschluss 17:00 statt 19:00.
const LOCAL_TZ = process.env.REPORT_TIMEZONE || 'Europe/Berlin';

// Buchungstypen, die über POST /transactions angelegt werden dürfen (REFUND entsteht nur durch Storno)
const SALE_TYPES = ['SALE', 'OWNER_USE', 'EXPIRED'];
const SALE_PAYMENT_METHODS = ['CASH', 'ACCOUNT', 'CARD'];
// Stornierbar sind dieselben Typen; eine REFUND-Zeile ist selbst schon die Gegenbuchung
const CANCELLABLE_TYPES = SALE_TYPES;
// Überziehungsrahmen für Zahlung per Kundenkonto
const ALLOWED_OVERDRAFT = 10.0;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

const SALE_INCLUDE = {
  items: { include: { article: true } },
  customer: { select: CUSTOMER_BASIC_SELECT },
  user: { select: { id: true, name: true } }
};

class TransactionService {
  // Bereits gebuchte Transaktion zu einer clientId (Idempotenz der Offline-Warteschlange)
  async findByClientId(clientId) {
    if (!clientId) return null;
    return prisma.transaction.findUnique({ where: { clientId }, include: SALE_INCLUDE });
  }

  async createSale(data, userId) {
    const { paymentMethod, items, type = 'SALE' } = data;
    const customerId = data.customerId || null;
    const clientId = normalizeClientId(data.clientId);
    // Offline gebuchte Verkäufe behalten ihren Zeitpunkt (richtiger Geschäftstag)
    const bookedAt = resolveClientCreatedAt(data.clientCreatedAt);

    if (!SALE_TYPES.includes(type)) {
      throw userError('Ungültiger Buchungstyp. Erlaubt: SALE, OWNER_USE, EXPIRED');
    }
    if (type === 'SALE' && !SALE_PAYMENT_METHODS.includes(paymentMethod)) {
      throw userError('Ungültige Zahlungsmethode');
    }
    if (type === 'SALE' && paymentMethod === 'ACCOUNT' && !customerId) {
      throw userError('Kunde erforderlich bei Zahlung per Kundenkonto');
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw userError('Keine Artikel im Warenkorb');
    }

    // Wiederholte Übertragung derselben Buchung: nicht erneut buchen, Original zurückgeben
    const existing = await this.findByClientId(clientId);
    if (existing) return { transaction: existing, warnings: [], duplicate: true };

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        let totalAmount = 0;
        const processedItems = [];
        const warnings = [];

        let customer = null;
        if (customerId) {
          customer = await tx.customer.findUnique({ where: { id: customerId } });
          if (!customer) throw userError('Kunde nicht gefunden', 404);
        }

        for (const item of items) {
          const article = item && item.articleId
            ? await tx.article.findUnique({ where: { id: String(item.articleId) } })
            : null;

          if (!article) {
            throw userError(`Artikel nicht gefunden: ${item && item.articleId ? item.articleId : '(ohne ID)'}`, 404);
          }
          if (!article.active) {
            throw userError(`Artikel nicht verfügbar: ${article.name}`);
          }

          const qty = Number(item.quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) {
            throw userError(`Ungültige Menge für ${article.name}`);
          }

          const price = Number(article.price || 0);
          const itemTotal = round2(price * qty);
          // Nur bei echtem Verkauf summieren wir den Betrag für die Bezahlung
          if (type === 'SALE') {
            totalAmount = round2(totalAmount + itemTotal);
          }

          // Lager reduzieren (darf negativ werden; Warnung, keine Blockade)
          const updatedArticle = await tx.article.update({
            where: { id: article.id },
            data: { stock: { decrement: qty } }
          });
          const projected = Number(updatedArticle.stock);
          if (projected < 0) {
            warnings.push(`Artikel "${article.name}" fällt auf ${projected}`);
          }

          // StockMovement (Menge negativ); bei EXPIRED/OWNER_USE ist der Typ der Grund
          const movementType = (type === 'EXPIRED' || type === 'OWNER_USE') ? type : 'SALE';
          await tx.stockMovement.create({
            data: {
              articleId: article.id,
              type: movementType,
              quantity: -qty,
              reason: type === 'SALE' ? 'Verkauf' : (type === 'EXPIRED' ? 'Abgelaufen' : 'Eigenverbrauch'),
              ...(bookedAt ? { createdAt: bookedAt } : {})
            }
          });

          processedItems.push({
            articleId: article.id,
            quantity: qty,
            pricePerUnit: price,
            totalPrice: itemTotal
          });
        }

        // Kundenkonto: Überziehungsrahmen atomar prüfen (parallele Verkäufe können ihn nicht gemeinsam überschreiten)
        if (type === 'SALE' && paymentMethod === 'ACCOUNT') {
          const balance = Number(customer.balance || 0);
          const charged = await tx.customer.updateMany({
            where: { id: customerId, balance: { gte: totalAmount - ALLOWED_OVERDRAFT } },
            data: { balance: { decrement: totalAmount } }
          });
          if (charged.count === 0) {
            throw userError(`Nicht genügend Guthaben. Limit: -€${ALLOWED_OVERDRAFT.toFixed(2)}, Aktuell: €${balance.toFixed(2)}, Benötigt: €${totalAmount.toFixed(2)}`);
          }
          if (balance - totalAmount < 0) {
            warnings.push(`Achtung: Kontostand negativ! Neuer Stand: €${(balance - totalAmount).toFixed(2)}`);
          }
        }

        const transaction = await tx.transaction.create({
          data: {
            type, // SALE, EXPIRED, OWNER_USE
            paymentMethod: (type === 'SALE') ? paymentMethod : 'CASH', // Fallback für Non-Sale
            totalAmount, // ist 0 bei EXPIRED/OWNER_USE
            userId,
            customerId,
            clientId,
            ...(bookedAt ? { createdAt: bookedAt } : {}),
            items: {
              create: processedItems
            }
          },
          include: SALE_INCLUDE
        });

        // Audits für negative Bestände (keine Blockade)
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

        // Offline-Nachbuchung in ein inzwischen abgeschlossenes Geschäftsjahr: kann nicht nachfragen,
        // wird angenommen und automatisch protokolliert (neue Verkäufe mit Serverzeit sind nie betroffen)
        if (bookedAt) {
          const closedYears = await closedPeriod.findClosedYears([bookedAt], tx);
          if (closedYears.length) {
            await closedPeriod.logChange(tx, closedYears, {
              userId, entityType: 'Transaction', entityId: transaction.id,
              operation: 'Offline-Nachbuchung',
              description: `Offline gebuchter ${saleLabel(transaction, transaction.customer)} nachträglich übertragen, ${closedPeriod.fmtEUR(totalAmount)}`,
              ...(type === 'SALE' ? { amountBefore: 0, amountAfter: totalAmount } : { effect: null }),
            });
          }
        }

        // Kompatibel: Warnungen auch am Objekt (alter Controller)
        transaction._warnings = warnings;

        // Letzte Aktivität (immer, auch bei Barzahlung); ein nachträglich übertragener Offline-Verkauf
        // setzt sie nicht zurück
        if (customer) {
          const activityAt = bookedAt || new Date();
          if (!customer.lastActivity || customer.lastActivity < activityAt) {
            await tx.customer.update({
              where: { id: customerId },
              data: { lastActivity: activityAt }
            });
          }
        }

        return { transaction, warnings };
      });
    } catch (error) {
      // Zwei gleichzeitige Übertragungen derselben clientId: die zweite scheitert am Unique-Index
      if (clientId && isUniqueViolation(error, 'clientId')) {
        const original = await this.findByClientId(clientId);
        if (original) return { transaction: original, warnings: [], duplicate: true };
      }
      throw error;
    }

    // WebSocket Events + Highscore
    const { emitNewSale } = require('../utils/websocket');
    const highscoreService = require('./highscoreService');

    emitNewSale(result.transaction);
    highscoreService.updateAfterSale(result.transaction.id).catch(err => {
      console.error('Error updating highscore:', err);
    });

    return { ...result, duplicate: false };
  }

  // Storniere Transaktion (legt eine verknüpfte REFUND-Buchung an, löscht nichts)
  async cancelTransaction(transactionId, userId, { confirmClosed = false } = {}) {
    const result = await prisma.$transaction(async (tx) => {
      const originalTransaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: {
          items: true,
          customer: { select: CUSTOMER_BASIC_SELECT }
        }
      });

      if (!originalTransaction) {
        throw userError('Transaktion nicht gefunden', 404);
      }
      if (!CANCELLABLE_TYPES.includes(originalTransaction.type)) {
        throw userError('Eine Storno-Buchung kann nicht storniert werden');
      }
      if (originalTransaction.cancelled) {
        throw userError('Transaktion wurde bereits storniert');
      }

      // Verkauf aus einem abgeschlossenen Geschäftsjahr: Storno ändert dessen Einnahmen/Bestand → 409 ohne Bestätigung
      const closedYears = await closedPeriod.guard([originalTransaction.createdAt], confirmClosed, tx);
      if (closedYears.length) {
        const amount = Number(originalTransaction.totalAmount || 0);
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'Transaction', entityId: transactionId,
          operation: 'Verkauf storniert',
          description: `${saleLabel(originalTransaction, originalTransaction.customer)} storniert, ${closedPeriod.fmtEUR(amount)}`,
          ...(originalTransaction.type === 'SALE' ? { amountBefore: amount, amountAfter: 0 } : { effect: null }),
        });
      }

      // Atomar als storniert markieren: von parallelen Stornos gewinnt genau eines
      const marked = await tx.transaction.updateMany({
        where: { id: transactionId, cancelled: false },
        data: {
          cancelled: true,
          cancelledAt: new Date(),
          cancelledBy: userId
        }
      });
      if (marked.count === 0) {
        throw userError('Transaktion wurde bereits storniert');
      }

      // Storno-Transaktion
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

      // Artikel zurück in den Bestand
      for (const item of originalTransaction.items) {
        await tx.article.update({
          where: { id: item.articleId },
          data: { stock: { increment: item.quantity } }
        });

        await tx.stockMovement.create({
          data: {
            articleId: item.articleId,
            type: 'CORRECTION',
            quantity: item.quantity,
            reason: 'Storno'
          }
        });
      }

      // Bei Kundenkonto: Guthaben zurückbuchen
      if (originalTransaction.paymentMethod === 'ACCOUNT' && originalTransaction.customerId) {
        await tx.customer.update({
          where: { id: originalTransaction.customerId },
          data: { balance: { increment: originalTransaction.totalAmount } }
        });
      }

      return {
        originalTransaction,
        cancelTransaction
      };
    });

    // Clubscore: ein Storno kann ein Ranking verändern → Boards neu berechnen und pushen
    require('./highscoreService').refreshBoards();
    return result;
  }

  // Liste Transaktionen
  // Kontoaufladungen im Zeitraum (eigene Tabelle AccountTopUp, keine Transaktionen).
  // Übernahme-Buchungen aus Clubtouch 2.0 (MIGRATION) nur auf Wunsch.
  async listTopUps(filters = {}) {
    const { startDate, endDate, customerId, includeMigration = false } = filters;
    const where = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = parseLocalDate(startDate);
      if (endDate) where.createdAt.lte = endOfLocalDay(endDate);
    }
    if (customerId) where.customerId = customerId;
    if (!includeMigration) where.method = { not: 'MIGRATION' };
    return prisma.accountTopUp.findMany({
      where,
      include: { customer: { select: CUSTOMER_BASIC_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listTransactions(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod, includeItems = false } = filters;

    const where = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = parseLocalDate(startDate);
      if (endDate) where.createdAt.lte = endOfLocalDay(endDate); // "Bis"-Tag inklusive
    }

    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    const include = {
      customer: { select: CUSTOMER_BASIC_SELECT },
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
        customer: { select: CUSTOMER_BASIC_SELECT },
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
  // Geschäftstag-Fenster (Standard 06:00 -> 06:00) kommt zentral aus utils/businessDay.
  // `date` darf ein Date oder 'YYYY-MM-DD' (lokal interpretiert) sein.
  async getDailySummary(date = new Date(), startHour = BUSINESS_DAY_START_HOUR) {
    const { start: startOfDay, end: endOfDay, businessDate } = businessDayWindow(date, startHour);

    const [
      totalSales,
      cashSales,
      accountSales,
      cancelledSales,
      topArticles,
      hourlyDistribution,
      cardSales
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
      WHERE t."createdAt" >= (${startOfDay}::timestamptz AT TIME ZONE 'UTC')
        AND t."createdAt" <= (${endOfDay}::timestamptz AT TIME ZONE 'UTC')
        AND t.cancelled = false
        AND t.type = 'SALE'
      GROUP BY a.id, a.name, a.category
      ORDER BY quantity_sold DESC
      LIMIT 10
    `,

      // Umsatzverteilung nach Stunden
      prisma.$queryRaw`
      SELECT hour, transactions, revenue FROM (
        SELECT 
          EXTRACT(HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${LOCAL_TZ})) as hour,
          COUNT(*) as transactions,
          SUM("totalAmount") as revenue
        FROM "Transaction"
        WHERE "createdAt" >= (${startOfDay}::timestamptz AT TIME ZONE 'UTC')
          AND "createdAt" <= (${endOfDay}::timestamptz AT TIME ZONE 'UTC')
          AND cancelled = false
          AND type = 'SALE'
        GROUP BY 1
      ) h
      ORDER BY CASE WHEN hour < ${startHour} THEN hour + 24 ELSE hour END
    `,
      // Karten-Umsatz (SumUp)
      prisma.transaction.aggregate({
        where: { type: 'SALE', paymentMethod: 'CARD', cancelled: false, createdAt: { gte: startOfDay, lte: endOfDay } },
        _sum: { totalAmount: true },
        _count: true
      })
    ]);

    function safeNumber(value) {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'bigint') return Number(value);
      return Number(value);
    }

    // Aufladungen, Stornos und die Transaktionsliste des Tages (für Tagesabschluss-PDF)
    const [topUps, refunds, dayTransactions] = await Promise.all([
      // Auslagen (REIMBURSEMENT) sind keine Aufladung mit Geldeingang und gehören nicht in den Tagesabschluss
      prisma.accountTopUp.findMany({
        where: { method: { in: ['CASH', 'TRANSFER', 'CARD'] }, createdAt: { gte: startOfDay, lte: endOfDay } },
        include: { customer: { select: { name: true, nickname: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.transaction.findMany({
        where: { type: 'REFUND', createdAt: { gte: startOfDay, lte: endOfDay } },
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true } },
          originalTransaction: { select: { id: true, createdAt: true, totalAmount: true } }
        },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.transaction.findMany({
        where: { type: { in: ['SALE', 'REFUND'] }, createdAt: { gte: startOfDay, lte: endOfDay } },
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true } },
          items: { select: { quantity: true } }
        },
        orderBy: { createdAt: 'asc' }
      })
    ]);

    const topUpsCash = topUps.filter(t => t.method === 'CASH').reduce((a, t) => a + safeNumber(t.amount), 0);
    const topUpsTransfer = topUps.filter(t => t.method === 'TRANSFER').reduce((a, t) => a + safeNumber(t.amount), 0);
    const topUpsCard = topUps.filter(t => t.method === 'CARD').reduce((a, t) => a + safeNumber(t.amount), 0);

    return {
      date: formatLocalDate(businessDate),
      startHour,
      window: { start: startOfDay, end: endOfDay },
      summary: {
        totalRevenue: safeNumber(totalSales._sum.totalAmount),
        totalTransactions: totalSales._count || 0,
        cashRevenue: safeNumber(cashSales._sum.totalAmount),
        cashTransactions: cashSales._count || 0,
        accountRevenue: safeNumber(accountSales._sum.totalAmount),
        accountTransactions: accountSales._count || 0,
        cardRevenue: safeNumber(cardSales._sum.totalAmount),
        cardTransactions: cardSales._count || 0,
        cancelledRevenue: safeNumber(cancelledSales._sum.totalAmount),
        cancelledTransactions: cancelledSales._count || 0,
        topUpsCash,
        topUpsTransfer,
        topUpsCard,
        topUpsTotal: topUpsCash + topUpsTransfer + topUpsCard,
        topUpsCount: topUps.length
      },
      topArticles: topArticles.map(a => ({ ...a, quantity_sold: safeNumber(a.quantity_sold), revenue: safeNumber(a.revenue) })),
      hourlyDistribution: hourlyDistribution.map(h => ({ hour: safeNumber(h.hour), transactions: safeNumber(h.transactions), revenue: safeNumber(h.revenue) })),
      topUps: topUps.map(t => ({
        id: t.id, createdAt: t.createdAt, method: t.method, amount: safeNumber(t.amount),
        reference: t.reference || null,
        customer: t.customer ? (t.customer.nickname ? `${t.customer.name} (${t.customer.nickname})` : t.customer.name) : '—'
      })),
      cancellations: refunds.map(r => ({
        id: r.id, createdAt: r.createdAt, paymentMethod: r.paymentMethod, amount: safeNumber(r.totalAmount),
        cashier: r.user ? r.user.name : '—', customer: r.customer ? r.customer.name : null,
        originalTransactionId: r.originalTransactionId,
        originalCreatedAt: r.originalTransaction ? r.originalTransaction.createdAt : null
      })),
      transactions: dayTransactions.map(t => ({
        id: t.id, createdAt: t.createdAt, type: t.type, paymentMethod: t.paymentMethod,
        amount: safeNumber(t.totalAmount), cancelled: t.cancelled,
        itemCount: t.items.reduce((a, i) => a + Number(i.quantity || 0), 0),
        customer: t.customer ? t.customer.name : null,
        cashier: t.user ? t.user.name : '—'
      }))
    };
  }

}

module.exports = new TransactionService();
