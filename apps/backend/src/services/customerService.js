const prisma = require('../utils/prisma');
const { userError, isUniqueViolation } = require('../utils/httpError');
const { normalizeClientId, resolveClientCreatedAt } = require('../utils/clientRequest');
const closedPeriod = require('../utils/closedPeriod');
const TOPUP_LABEL = { CASH: 'bar', TRANSFER: 'Überweisung', CARD: 'Karte', REIMBURSEMENT: 'Auslage', MIGRATION: 'Übernahme' };

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Gruppen-Select für Kunden-Antworten
const GROUP_SELECT = {
  select: {
    id: true,
    name: true,
    color: true,
    emoji: true,
    imageUrl: true,
  },
};

// Standard-Include für Listen und Einzel-Abfragen
const CUSTOMER_INCLUDE_BASE = {
  group: GROUP_SELECT,
};

function triggerRefreshBoards() {
  try {
    const hs = require('./highscoreService');
    Promise.resolve(hs.refreshBoards?.()).catch((err) =>
      console.error('[CustomerService] refreshBoards Fehler:', err)
    );
  } catch (err) {
    console.error('[CustomerService] highscoreService laden fehlgeschlagen:', err);
  }
}

class CustomerService {
  // Liste alle Kunden
  async listCustomers(search = '', groupId = null) {
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (groupId) {
      where.groupId = groupId;
    }

    return await prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        ...CUSTOMER_INCLUDE_BASE,
        _count: {
          select: { transactions: true },
        },
      },
    });
  }

  // Finde Kunde by ID
  async findById(id) {
    return await prisma.customer.findUnique({
      where: { id },
      include: {
        ...CUSTOMER_INCLUDE_BASE,
        accountTopUps: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                article: true,
              },
            },
          },
        },
      },
    });
  }

  // Kontaktfelder aus rohen Daten extrahieren; leere Strings als null speichern
  _pickContact(data) {
    const fields = ['company', 'street', 'zip', 'city', 'phone', 'email'];
    const result = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(data, f)) {
        result[f] = data[f] || null;
      }
    }
    return result;
  }

  // Name schon vergeben? Ohne Beachtung von Groß-/Kleinschreibung, weil die öffentliche
  // Guthabenabfrage den Namen ebenso sucht (sonst wäre sie mehrdeutig).
  async _nameTaken(name, exceptId = null) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    const existing = await prisma.customer.findFirst({
      where: {
        name: { equals: trimmed, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  // Erstelle neuen Kunden
  async createCustomer(data) {
    if (await this._nameTaken(data.name)) {
      throw userError('Ein Kunde mit diesem Namen existiert bereits');
    }

    // groupId validieren
    let groupId = null;
    if (data.groupId) {
      const group = await prisma.customerGroup.findUnique({ where: { id: data.groupId } });
      if (!group) throw Object.assign(new Error('Gruppe nicht gefunden'), { userError: true, status: 400 });
      groupId = data.groupId;
    }

    // Aktualisiere lastActivity beim Erstellen
    const customer = await prisma.customer.create({
      data: {
        name: data.name,
        nickname: data.nickname,
        gender: data.gender || 'OTHER',
        active: data.active !== undefined ? data.active : true,
        balance: 0,
        lastActivity: new Date(),
        groupId,
        isGroupAccount: data.isGroupAccount ? true : false,
        ...this._pickContact(data),
      },
      include: { group: GROUP_SELECT },
    });

    triggerRefreshBoards();
    return customer;
  }


  // Update Kunde
  async updateCustomer(id, data) {
    const current = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!current) throw userError('Kunde nicht gefunden', 404);

    if (data.name && (await this._nameTaken(data.name, id))) {
      throw userError('Ein anderer Kunde mit diesem Namen existiert bereits');
    }

    // groupId: '' oder null → null; UUID → prüfen
    let groupId = undefined; // undefined = nicht ändern
    if (Object.prototype.hasOwnProperty.call(data, 'groupId')) {
      if (!data.groupId) {
        groupId = null;
      } else {
        const group = await prisma.customerGroup.findUnique({ where: { id: data.groupId } });
        if (!group) throw Object.assign(new Error('Gruppe nicht gefunden'), { userError: true, status: 400 });
        groupId = data.groupId;
      }
    }

    const updateData = {
      name: data.name,
      nickname: data.nickname,
      gender: data.gender,
      active: data.active,
      // lastActivity bewusst nicht: bloßes Bearbeiten ist kein Besuch an der Theke
      ...this._pickContact(data),
    };

    if (groupId !== undefined) updateData.groupId = groupId;
    if (Object.prototype.hasOwnProperty.call(data, 'isGroupAccount')) {
      updateData.isGroupAccount = Boolean(data.isGroupAccount);
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: updateData,
      include: { group: GROUP_SELECT },
    });

    // refreshBoards wenn relevante Felder geändert wurden
    const relevantFields = ['name', 'nickname', 'groupId', 'isGroupAccount', 'active'];
    const hasRelevant = relevantFields.some((f) => Object.prototype.hasOwnProperty.call(data, f));
    if (hasRelevant) triggerRefreshBoards();

    return customer;
  }


  // Guthaben aufladen. options: { clientId, clientCreatedAt } aus der Offline-Warteschlange.
  // Mit bekannter clientId wird nicht erneut gebucht: Rückgabe { topUp, customer, duplicate: true }.
  async topUpAccount(customerId, amount, method, reference = null, options = {}) {
    // options.userId: für das Protokoll einer Offline-Nachbuchung in ein abgeschlossenes Geschäftsjahr
    const value = round2(amount);
    if (!(value > 0)) {
      throw userError('Betrag muss größer als 0 sein');
    }
    const clientId = normalizeClientId(options.clientId);
    const bookedAt = resolveClientCreatedAt(options.clientCreatedAt);

    const existingCustomer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!existingCustomer) throw userError('Kunde nicht gefunden', 404);

    const duplicateOf = async () => {
      if (!clientId) return null;
      const topUp = await prisma.accountTopUp.findUnique({ where: { clientId } });
      if (!topUp) return null;
      if (topUp.customerId !== customerId) {
        throw userError('Diese clientId gehört zu einer Aufladung eines anderen Kunden', 409);
      }
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, include: { group: GROUP_SELECT } });
      return { topUp, customer, duplicate: true };
    };

    const dup = await duplicateOf();
    if (dup) return dup;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const topUp = await tx.accountTopUp.create({
          data: {
            customerId,
            amount: value,
            method,
            reference: reference || null,
            clientId,
            ...(bookedAt ? { createdAt: bookedAt } : {}),
          },
        });

        const customer = await tx.customer.update({
          where: { id: customerId },
          data: { balance: { increment: value } },
          include: { group: GROUP_SELECT },
        });

        // Offline-Nachbuchung in ein inzwischen abgeschlossenes Geschäftsjahr: annehmen und protokollieren
        if (bookedAt && options.userId) {
          const closedYears = await closedPeriod.findClosedYears([bookedAt], tx);
          if (closedYears.length) {
            await closedPeriod.logChange(tx, closedYears, {
              userId: options.userId, entityType: 'AccountTopUp', entityId: topUp.id,
              operation: 'Offline-Nachbuchung',
              description: `Offline gebuchte Aufladung (${TOPUP_LABEL[method] || method}) für ${customer.nickname || customer.name} vom ${closedPeriod.fmtDate(bookedAt)} nachträglich übertragen, ${closedPeriod.fmtEUR(value)} (Guthaben, kein Ertrag)`,
              effect: null,
            });
          }
        }

        return { topUp, customer };
      });
      return { ...result, duplicate: false };
    } catch (error) {
      // Gleichzeitige Übertragung derselben clientId
      if (clientId && isUniqueViolation(error, 'clientId')) {
        const again = await duplicateOf();
        if (again) return again;
      }
      throw error;
    }
  }

  // Kunden-Statistiken
  async getCustomerStats(customerId) {
    const [customer, totalSpent, transactionCount, favoriteArticles] = await Promise.all([
      // Basis-Kundendaten
      prisma.customer.findUnique({
        where: { id: customerId },
        include: { group: GROUP_SELECT },
      }),

      // Gesamtausgaben – nur echte Verkäufe (REFUND ist die Gegenbuchung eines Stornos, kein Kauf)
      prisma.transaction.aggregate({
        where: {
          customerId,
          type: 'SALE',
          cancelled: false,
        },
        _sum: {
          totalAmount: true,
        },
      }),

      // Anzahl Käufe
      prisma.transaction.count({
        where: {
          customerId,
          type: 'SALE',
          cancelled: false,
        },
      }),

      // Lieblingsartikel (Top 5)
      prisma.$queryRaw`
        SELECT
          a.id,
          a.name,
          a.category,
          SUM(ti.quantity) as total_quantity,
          SUM(ti."totalPrice") as total_spent
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."customerId" = ${customerId}
          AND t.type = 'SALE'
          AND t.cancelled = false
        GROUP BY a.id, a.name, a.category
        ORDER BY total_quantity DESC
        LIMIT 5
      `,
    ]);

    return {
      customer,
      totalSpent: totalSpent._sum.totalAmount || 0,
      transactionCount,
      favoriteArticles,
    };
  }

  // Kunden mit niedrigem Guthaben
  async getCustomersWithLowBalance(threshold = 5) {
    return await prisma.customer.findMany({
      where: {
        balance: {
          lt: threshold,
          gt: 0,
        },
      },
      orderBy: { balance: 'asc' },
      include: { group: GROUP_SELECT },
    });
  }

  // Kontoauszug mit laufendem Saldo.
  // Kontowirksam sind nur Aufladungen (alle Methoden inkl. Storno, Auslage, Übernahme) und Transaktionen
  // mit paymentMethod ACCOUNT: der Verkauf belastet, seine REFUND-Zeile schreibt gut (ein stornierter
  // Verkauf erscheint also mit −x und das Storno mit +x). Bar-/Kartenkäufe mit Kundenzuordnung werden
  // mit Betrag 0 angezeigt. Saldo am Ende des Zeitraums = aktuelles Guthaben − alle kontowirksamen
  // Bewegungen nach dem Zeitraum, so stimmt er auch für Zeiträume in der Vergangenheit.
  async getAccountStatement(customerId, startDate, endDate) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, nickname: true, balance: true },
    });
    if (!customer) {
      throw userError('Kunde nicht gefunden', 404);
    }

    const inPeriod = { gte: startDate, lte: endDate };
    const [topUps, transactions, topUpsAfter, accountTxAfter] = await Promise.all([
      prisma.accountTopUp.findMany({
        where: { customerId, createdAt: inPeriod },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { customerId, createdAt: inPeriod, type: { in: ['SALE', 'REFUND'] } },
        include: {
          items: { include: { article: true } },
          originalTransaction: { select: { type: true, createdAt: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.accountTopUp.aggregate({
        where: { customerId, createdAt: { gt: endDate } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { customerId, paymentMethod: 'ACCOUNT', createdAt: { gt: endDate } },
        _sum: { totalAmount: true },
      }),
    ]);

    const methodLabel = { CASH: 'bar', CARD: 'mit Karte', TRANSFER: 'per Überweisung', INVOICE: 'auf Rechnung' };
    const movements = [];

    // Aufladungen
    topUps.forEach((topUp) => {
      movements.push({
        id: topUp.id,
        date: topUp.createdAt,
        type: 'TOPUP',
        method: topUp.method,
        description:
          String(topUp.reference || '').startsWith('STORNO:')
            ? 'Storno einer Aufladung'
            : topUp.method === 'REIMBURSEMENT'
            ? topUp.reference || 'Auslage'
            : topUp.method === 'MIGRATION'
            ? topUp.reference || 'Übernahme Clubtouch 2.0'
            : `Aufladung (${topUp.method === 'CASH' ? 'Bar' : topUp.method === 'CARD' ? 'Karte' : 'Überweisung'})`,
        amount: round2(topUp.amount),
        balance: 0, // wird unten berechnet
      });
    });

    // Verkäufe und ihre Stornos (REFUND von „Auf den Wirt“/„Abgelaufen“ betrifft kein Kundenkonto)
    let totalRefunds = 0;
    let totalPaidDirect = 0;
    let saleCount = 0;
    transactions.forEach((t) => {
      const onAccount = t.paymentMethod === 'ACCOUNT';
      const total = Number(t.totalAmount);
      const articles = `${t.items.length} Artikel`;
      if (t.type === 'REFUND') {
        if (t.originalTransaction && t.originalTransaction.type !== 'SALE') return;
        if (onAccount) totalRefunds = round2(totalRefunds - total);
        movements.push({
          id: t.id,
          date: t.createdAt,
          type: 'CANCELLED', // im PDF „Storno“
          txType: 'REFUND',
          paymentMethod: t.paymentMethod,
          originalTransactionId: t.originalTransactionId,
          description: onAccount
            ? `Storno eines Einkaufs (${articles})`
            : `Storno eines Einkaufs (${articles}, ${methodLabel[t.paymentMethod] || 'bar'} erstattet – Guthaben unverändert)`,
          amount: onAccount ? round2(-total) : 0,
          balance: 0,
        });
        return;
      }
      if (!onAccount) totalPaidDirect = round2(totalPaidDirect + total);
      else if (!t.cancelled) saleCount += 1;
      movements.push({
        id: t.id,
        date: t.createdAt,
        type: 'PURCHASE',
        txType: 'SALE',
        paymentMethod: t.paymentMethod,
        cancelled: t.cancelled,
        description:
          (t.cancelled ? '[STORNIERT] ' : '') +
          (onAccount
            ? `Einkauf (${articles})`
            : `Einkauf (${articles}, ${methodLabel[t.paymentMethod] || 'bar'} bezahlt – Guthaben unverändert)`),
        amount: onAccount ? round2(-total) : 0,
        balance: 0,
      });
    });

    // Chronologisch (bei gleicher Zeit bleibt die Einfügereihenfolge)
    movements.sort((a, b) => new Date(a.date) - new Date(b.date));

    const currentBalance = round2(customer.balance);
    const effectAfter =
      Number(topUpsAfter._sum.amount || 0) - Number(accountTxAfter._sum.totalAmount || 0);
    const closingBalance = round2(currentBalance - effectAfter);
    const periodEffect = movements.reduce((sum, m) => sum + m.amount, 0);
    const openingBalance = round2(closingBalance - periodEffect);

    let running = openingBalance;
    for (const m of movements) {
      running = round2(running + m.amount);
      m.balance = running;
    }

    const totalTopUps = round2(topUps.reduce((sum, t) => sum + Number(t.amount), 0));
    // Belastung des Kontos im Zeitraum (Einkäufe per Konto abzüglich Stornos), damit gilt:
    // openingBalance + totalTopUps − totalSpent = closingBalance
    const totalSpent = round2(totalTopUps - (closingBalance - openingBalance));

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        nickname: customer.nickname,
        currentBalance,
      },
      startDate,
      endDate,
      openingBalance,
      closingBalance,
      movements,
      summary: {
        totalTopUps,
        totalSpent,
        totalRefunds,
        totalPaidDirect, // bar/Karte bezahlte Einkäufe mit Kundenzuordnung (nicht kontowirksam)
        transactionCount: saleCount,
        openingBalance,
        closingBalance,
      },
    };
  }

  // Kombinierte Historie (Transaktionen + Aufladungen).
  // amount bleibt wie bisher (Kauf negativ, storniert 0, REFUND-Zeile positiv); kontowirksam ist nur,
  // was balanceEffect zeigt (0 bei Bar/Karte). Stornos sind über txType 'REFUND' und isRefund kenntlich.
  async getHistory(customerId, limit = 50) {
    const [transactions, topUps] = await Promise.all([
      prisma.transaction.findMany({
        where: { customerId },
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { article: true } } },
      }),
      prisma.accountTopUp.findMany({
        where: { customerId },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const combined = [
      ...transactions.map((t) => {
        const total = Number(t.totalAmount);
        return {
          type: 'TRANSACTION',
          txType: t.type, // SALE | REFUND (Gegenbuchung eines Stornos) | OWNER_USE | EXPIRED
          isRefund: t.type === 'REFUND',
          id: t.id,
          date: t.createdAt,
          amount: t.cancelled ? 0 : -total, // Ausgaben negativ, REFUND-Zeile positiv
          originalAmount: total,
          balanceEffect: t.paymentMethod === 'ACCOUNT' ? round2(-total) : 0,
          method: t.paymentMethod,
          items: t.items,
          cancelled: t.cancelled,
          cancelledAt: t.cancelledAt,
          originalTransactionId: t.originalTransactionId,
        };
      }),
      ...topUps.map((t) => ({
        type: 'TOPUP',
        id: t.id,
        date: t.createdAt,
        amount: Number(t.amount), // Einzahlungen sind positiv
        balanceEffect: round2(t.amount),
        method: t.method,
        reference: t.reference,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return combined.slice(0, limit);
  }

  // Aufladung stornieren (Gegenbuchung). customerId (aus der URL) muss zur Aufladung passen.
  async reverseTopUp(topUpId, userId, customerId = null, { confirmClosed = false } = {}) {
    return await prisma.$transaction(async (tx) => {
      // Zeile sperren: parallele Stornos derselben Aufladung laufen nacheinander und das zweite
      // sieht die Gegenbuchung des ersten
      await tx.$queryRaw`SELECT id FROM "AccountTopUp" WHERE id = ${topUpId} FOR UPDATE`;
      const original = await tx.accountTopUp.findUnique({ where: { id: topUpId } });
      if (!original || (customerId && original.customerId !== customerId)) {
        throw userError('Aufladung nicht gefunden', 404);
      }
      if (original.method === 'REIMBURSEMENT') {
        throw userError('Auslagen werden über die Lieferantenrechnung zurückgebucht (im Einkauf auf „offen" setzen).');
      }
      if (original.method === 'MIGRATION') {
        throw userError('Das übernommene Startguthaben aus Clubtouch 2.0 kann nicht storniert werden.');
      }
      if (Number(original.amount) < 0 || String(original.reference || '').startsWith('STORNO:')) {
        throw userError('Eine Gegenbuchung kann nicht erneut storniert werden.');
      }

      // Bereits storniert? Die Gegenbuchung trägt die ID der Originalbuchung in reference
      const alreadyReversed = await tx.accountTopUp.findFirst({
        where: { reference: `STORNO:${topUpId}` },
      });
      if (alreadyReversed) throw userError('Diese Aufladung wurde bereits storniert');

      // Aufladung aus einem abgeschlossenen Geschäftsjahr → 409 ohne Bestätigung
      const closedYears = await closedPeriod.guard([original.createdAt], confirmClosed, tx);
      if (closedYears.length) {
        const cust = await tx.customer.findUnique({ where: { id: original.customerId }, select: { name: true, nickname: true } });
        await closedPeriod.logChange(tx, closedYears, {
          userId, entityType: 'AccountTopUp', entityId: topUpId,
          operation: 'Aufladung storniert',
          description: `Aufladung (${TOPUP_LABEL[original.method] || original.method}) für ${cust ? (cust.nickname || cust.name) : 'Kunde'} vom ${closedPeriod.fmtDate(original.createdAt)} storniert, ${closedPeriod.fmtEUR(original.amount)} (Guthaben, kein Ertrag)`,
          effect: null,
        });
      }

      const reversal = await tx.accountTopUp.create({
        data: {
          customerId: original.customerId,
          amount: -Number(original.amount),
          method: original.method,
          reference: `STORNO:${topUpId}`,
        },
      });

      await tx.customer.update({
        where: { id: original.customerId },
        data: { balance: { decrement: original.amount } },
      });

      return reversal;
    });
  }
}

module.exports = new CustomerService();
