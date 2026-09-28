// services/cashCountService.js
//
// Kassenzählung als eigener, gespeicherter Vorgang.
//
// Die Kasse wird im Clubraum nicht täglich gezählt. Jede Zählung friert deshalb
// ihren eigenen Soll-Wert ein (breakdownJson), damit der Zählbeleg später auch
// dann noch stimmt, wenn nachträglich Buchungen im Zeitraum erfasst wurden.
//
// Soll seit der letzten Zählung:
//   Vorzählung (countedTotal)
//   + Bar-Verkäufe        (Transaction SALE, CASH, nach Buchungszeit)
//   + Bar-Erstattungen    (Transaction REFUND, CASH, Betrag negativ -> wird addiert)
//   + Bar-Aufladungen     (AccountTopUp CASH)
//   - Bar-Ausgaben        (PurchaseDocument RECHNUNG, paid, CASH; paidAt, ersatzweise documentDate)
//   - Einzahlungen auf Bank  (CashMovement DEPOSIT_TO_BANK)
//   + Abhebungen von Bank    (CashMovement WITHDRAWAL_FROM_BANK)
//   + Sonstige Bareinnahmen  (CashMovement OTHER_INCOME)
//   - Sonstige Barausgaben   (CashMovement OTHER_EXPENSE)
//
// Bewusst NICHT "cancelled = false" bei den Verkäufen: Ein Storno legt eine
// REFUND-Buchung mit negativem Betrag an und markiert das Original als
// cancelled. Das Geld ist beim Verkauf physisch in die Kasse gekommen und beim
// Storno wieder herausgegangen. Zählt man das stornierte Original nicht UND die
// Erstattung negativ, wäre der Betrag doppelt abgezogen. Über die jeweiligen
// Buchungszeitpunkte landet beides im richtigen Zählfenster.

const prisma = require('../utils/prisma');
const cashMovementService = require('./cashMovementService');

const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const DENOMINATION_KEYS = DENOMINATIONS.map(d => String(d));

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dec = (n) => Number(n || 0);

// Prisma-Decimal serialisiert sich per toJSON() als String, bevor der JSON-Replacer
// in app.js greift. Für eine saubere API geben wir hier Zahlen zurück.
function toPlain(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of ['countedTotal', 'expectedTotal', 'difference']) {
    if (out[k] !== undefined && out[k] !== null) out[k] = Number(out[k]);
  }
  if (out.previousCount) out.previousCount = toPlain(out.previousCount);
  return out;
}

class CashCountService {
  get denominations() { return DENOMINATIONS; }

  /**
   * Stückelung normalisieren: alle Schlüssel vorhanden, Werte nichtnegative Ganzzahlen.
   * Unbekannte Schlüssel oder ungültige Werte -> Error.
   */
  normalizeDenominations(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Stückelung fehlt oder ist kein Objekt');
    }
    const out = {};
    for (const key of Object.keys(input)) {
      const normKey = String(Number(key));
      if (!DENOMINATION_KEYS.includes(normKey)) {
        throw new Error(`Unbekannte Stückelung: ${key}`);
      }
      const val = input[key];
      if (val === null || val === undefined || val === '') { out[normKey] = 0; continue; }
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Anzahl für ${normKey} € muss eine nichtnegative ganze Zahl sein`);
      }
      out[normKey] = n;
    }
    for (const key of DENOMINATION_KEYS) if (!(key in out)) out[key] = 0;
    return out;
  }

  /** Summe der Stückelung in Euro (auf Cent gerundet). */
  sumDenominations(denominations) {
    // in Cent rechnen, um Fließkomma-Fehler (0.1 + 0.2) zu vermeiden
    let cents = 0;
    for (const d of DENOMINATIONS) {
      const count = Number(denominations[String(d)] || 0);
      cents += Math.round(d * 100) * count;
    }
    return cents / 100;
  }

  /** Neueste Zählung (optional nur bis zu einem Zeitpunkt). */
  async getLatest({ until = null } = {}) {
    return toPlain(await prisma.cashCount.findFirst({
      where: until ? { countedAt: { lte: until } } : undefined,
      orderBy: { countedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } }
    }));
  }

  /** Letzte Zählung im Zeitraum [start, end] (für den Jahresabschluss). */
  async getLatestInPeriod(start, end) {
    return toPlain(await prisma.cashCount.findFirst({
      where: { countedAt: { gte: start, lte: end } },
      orderBy: { countedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } }
    }));
  }

  async getById(id) {
    return toPlain(await prisma.cashCount.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        previousCount: { select: { id: true, countedAt: true, countedTotal: true } }
      }
    }));
  }

  async listCounts({ limit = 50 } = {}) {
    const rows = await prisma.cashCount.findMany({
      orderBy: { countedAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 50, 1), 500),
      include: {
        user: { select: { id: true, name: true } },
        previousCount: { select: { id: true, countedAt: true, countedTotal: true } }
      }
    });
    return rows.map(toPlain);
  }

  /**
   * Barbewegungen im Fenster (since exklusiv, until inklusiv).
   * since = null -> ohne untere Grenze.
   * Enthält zusätzlich Kassenbewegungen (CashMovement) aus cashMovementService.
   */
  async getCashMovements(since, until) {
    const window = { lte: until };
    if (since) window.gt = since;

    const [salesAgg, refundsAgg, topUpsAgg, cashExpenseDocs, mvSummary] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'SALE', paymentMethod: 'CASH', createdAt: window },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.transaction.aggregate({
        where: { type: 'REFUND', paymentMethod: 'CASH', createdAt: window },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.accountTopUp.aggregate({
        where: { method: 'CASH', createdAt: window },
        _sum: { amount: true }, _count: true
      }),
      prisma.purchaseDocument.findMany({
        where: {
          type: 'RECHNUNG', paid: true, paymentMethod: 'CASH',
          OR: [
            { paidAt: window },
            { paidAt: null, documentDate: window }
          ]
        },
        select: { id: true, documentNumber: true, supplier: true, totalAmount: true, paidAt: true, documentDate: true },
        orderBy: { documentDate: 'asc' }
      }),
      cashMovementService.summarize(window)
    ]);

    const cashSales = round2(dec(salesAgg._sum.totalAmount));
    const cashRefunds = round2(dec(refundsAgg._sum.totalAmount)); // negativ
    const cashTopUps = round2(dec(topUpsAgg._sum.amount));
    const cashExpenses = round2(cashExpenseDocs.reduce((a, d) => a + dec(d.totalAmount), 0)); // positiv

    return {
      cashSales, cashRefunds, cashTopUps, cashExpenses,
      // Kassenbewegungen additiv
      bankDeposits: mvSummary.bankDeposits,
      bankWithdrawals: mvSummary.bankWithdrawals,
      otherIncome: mvSummary.otherIncome,
      otherExpense: mvSummary.otherExpense,
      movements: mvSummary.items,
      counts: {
        sales: salesAgg._count || 0,
        refunds: refundsAgg._count || 0,
        topUps: topUpsAgg._count || 0,
        expenses: cashExpenseDocs.length,
        bankDeposits: mvSummary.bankDeposits.count,
        bankWithdrawals: mvSummary.bankWithdrawals.count,
        otherIncome: mvSummary.otherIncome.count,
        otherExpense: mvSummary.otherExpense.count
      },
      expenseDocs: cashExpenseDocs.map(d => ({
        id: d.id, documentNumber: d.documentNumber, supplier: d.supplier,
        amount: dec(d.totalAmount), paidAt: d.paidAt || d.documentDate
      }))
    };
  }

  /**
   * Barbestand-Soll zum Zeitpunkt `until`, ausgehend von der letzten Zählung vor `until`.
   * @returns {{ hasBaseline, previousCount, since, until, baseline, cashSales, cashRefunds,
   *             cashTopUps, cashExpenses, expectedTotal, counts, expenseDocs }}
   */
  async getExpectedCash(since = undefined, until = new Date()) {
    let previous = null;
    if (since === undefined) {
      previous = await this.getLatest({ until });
      since = previous ? previous.countedAt : null;
    } else if (since) {
      previous = await prisma.cashCount.findFirst({
        where: { countedAt: since },
        orderBy: { countedAt: 'desc' },
        include: { user: { select: { id: true, name: true } } }
      });
    }

    const baseline = previous ? dec(previous.countedTotal) : 0;
    const mv = await this.getCashMovements(since, until);
    const expectedTotal = round2(
      baseline + mv.cashSales + mv.cashRefunds + mv.cashTopUps - mv.cashExpenses
      - (mv.bankDeposits ? mv.bankDeposits.total : 0)
      + (mv.bankWithdrawals ? mv.bankWithdrawals.total : 0)
      + (mv.otherIncome ? mv.otherIncome.total : 0)
      - (mv.otherExpense ? mv.otherExpense.total : 0)
    );

    return {
      hasBaseline: !!previous,
      previousCount: previous ? {
        id: previous.id, countedAt: previous.countedAt,
        countedTotal: dec(previous.countedTotal), user: previous.user || null
      } : null,
      since: since || null,
      until,
      baseline,
      ...mv,
      expectedTotal
    };
  }

  /** Vorschau: Was würde eine Zählung jetzt als Soll erwarten? */
  async getPreview() {
    const preview = await this.getExpectedCash(undefined, new Date());
    return { ...preview, denominations: DENOMINATIONS };
  }

  /** Zählung anlegen; Ist-Betrag wird serverseitig aus der Stückelung berechnet. */
  async createCount({ denominations, note, userId }) {
    if (!userId) throw new Error('Benutzer fehlt');
    const normalized = this.normalizeDenominations(denominations);
    const countedTotal = this.sumDenominations(normalized);
    const countedAt = new Date();

    const expected = await this.getExpectedCash(undefined, countedAt);
    const difference = round2(countedTotal - expected.expectedTotal);

    const breakdown = {
      hasBaseline: expected.hasBaseline,
      baseline: expected.baseline,
      since: expected.since,
      cashSales: expected.cashSales,
      cashRefunds: expected.cashRefunds,
      cashTopUps: expected.cashTopUps,
      cashExpenses: expected.cashExpenses,
      bankDeposits: expected.bankDeposits,
      bankWithdrawals: expected.bankWithdrawals,
      otherIncome: expected.otherIncome,
      otherExpense: expected.otherExpense,
      movements: expected.movements,
      counts: expected.counts,
      expenseDocs: expected.expenseDocs
    };

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.cashCount.create({
        data: {
          countedAt,
          denominations: normalized,
          countedTotal,
          expectedTotal: expected.expectedTotal,
          difference,
          breakdownJson: breakdown,
          note: note ? String(note).trim() || null : null,
          userId,
          previousCountId: expected.previousCount ? expected.previousCount.id : null
        },
        include: {
          user: { select: { id: true, name: true } },
          previousCount: { select: { id: true, countedAt: true, countedTotal: true } }
        }
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'CASH_COUNT',
          entityType: 'CashCount',
          entityId: row.id,
          changes: {
            countedTotal, expectedTotal: expected.expectedTotal, difference,
            previousCountId: row.previousCountId, note: row.note
          }
        }
      });

      return row;
    });

    return toPlain(created);
  }
}

module.exports = new CashCountService();
