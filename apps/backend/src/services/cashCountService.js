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
//   (Kassenbewegungen zählen nach max(occurredAt, createdAt): eine nach der letzten Zählung
//    erfasste, aber davor datierte Bewegung landet in der nächsten Zählung. Bar-Zahlungen von
//    Rechnungen dürfen gar nicht vor die letzte Zählung datiert werden, siehe
//    assertCashPaymentAfterLastCount.)
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
const CASH_FLOAT_KEY = 'cash.float';
const CARD_FEE_KEY = 'card.feePercent';

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

  /**
   * Bar-Zahlungen von Kunden- und Lieferantenrechnungen dürfen nicht vor die letzte Kassenzählung
   * datiert werden. Das Zählfenster läuft nach Zahldatum; eine nachträglich erfasste Zahlung mit
   * Datum vor der letzten Zählung fiele in kein Fenster (für Rechnungen gibt es keinen unveränderlichen
   * Erfassungszeitpunkt, updatedAt ändert sich z. B. beim Nachreichen des Scans).
   * Wirft einen 400er-Fehler mit Meldung, sonst nichts.
   */
  async assertCashPaymentAfterLastCount(when, db = prisma) {
    const t = when instanceof Date ? when : new Date(when);
    if (Number.isNaN(t.getTime())) return;
    const last = await db.cashCount.findFirst({ orderBy: { countedAt: 'desc' }, select: { countedAt: true } });
    if (last && t.getTime() <= new Date(last.countedAt).getTime()) {
      const at = new Date(last.countedAt);
      const fmt = `${at.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} um ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
      const err = new Error(`Eine Bar-Zahlung kann nicht vor die letzte Kassenzählung (${fmt}) datiert werden, sonst fehlt sie im Kassen-Soll. Bitte als Zahldatum heute bzw. einen Zeitpunkt nach der Zählung wählen.`);
      err.statusCode = 400;
      err.userFacing = true;
      throw err;
    }
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

    const [salesAgg, refundsAgg, topUpsAgg, cashExpenseDocs, mvSummary, cashInvoiceRows] = await Promise.all([
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
      // Kassenbewegungen: nach max(Datum, Erfassung), damit rückdatierte Nachträge nicht verloren gehen
      cashMovementService.summarize(window, { cashCount: { since, until } }),
      // Bar bezahlte Kundenrechnungen: das Geld landet in der Kasse (Zahlungsart seit 09/2026;
      // Altbestand ohne Zahlungsart gilt als Bank und taucht hier nicht auf)
      prisma.invoice.findMany({
        where: { status: 'PAID', paymentMethod: 'CASH', paidAt: window },
        select: { id: true, invoiceNumber: true, customerName: true, totalAmount: true, paidAt: true },
        orderBy: { paidAt: 'asc' }
      })
    ]);

    const cashSales = round2(dec(salesAgg._sum.totalAmount));
    const cashRefunds = round2(dec(refundsAgg._sum.totalAmount)); // negativ
    const cashTopUps = round2(dec(topUpsAgg._sum.amount));
    const cashExpenses = round2(cashExpenseDocs.reduce((a, d) => a + dec(d.totalAmount), 0)); // positiv
    const cashInvoices = {
      total: round2(cashInvoiceRows.reduce((a, i) => a + dec(i.totalAmount), 0)),
      count: cashInvoiceRows.length,
      items: cashInvoiceRows.map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, customerName: i.customerName,
        amount: dec(i.totalAmount), paidAt: i.paidAt
      }))
    };

    return {
      cashSales, cashRefunds, cashTopUps, cashExpenses,
      cashInvoices,
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
        cashInvoices: cashInvoiceRows.length,
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
      + (mv.cashInvoices ? mv.cashInvoices.total : 0)
      - (mv.bankDeposits ? mv.bankDeposits.total : 0)
      + (mv.bankWithdrawals ? mv.bankWithdrawals.total : 0)
      + (mv.otherIncome ? mv.otherIncome.total : 0)
      - (mv.otherExpense ? mv.otherExpense.total : 0)
    );

    return {
      hasBaseline: !!previous,
      previousCount: previous ? {
        id: previous.id, countedAt: previous.countedAt,
        countedTotal: dec(previous.countedTotal), isOpening: !!previous.isOpening, user: previous.user || null
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

  /** Einstellungen Kasse & Bank: Wechselgeld-Sockel und SumUp-Gebührensatz (%) */
  async getSettings() {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [CASH_FLOAT_KEY, CARD_FEE_KEY] } } });
    const get = (k) => round2(Number(rows.find((r) => r.key === k)?.value) || 0);
    return { float: get(CASH_FLOAT_KEY), cardFeePercent: get(CARD_FEE_KEY) };
  }

  async setSettings({ float, cardFeePercent } = {}) {
    const put = (key, v, description) => prisma.systemSetting.upsert({
      where: { key }, update: { value: String(v) }, create: { key, value: String(v), description },
    });
    if (float !== undefined) await put(CASH_FLOAT_KEY, Math.max(0, round2(Number(String(float).replace(',', '.')) || 0)), 'Wechselgeld-Sockel der Barkasse in €');
    if (cardFeePercent !== undefined) {
      const pct = Math.min(20, Math.max(0, round2(Number(String(cardFeePercent).replace(',', '.')) || 0)));
      await put(CARD_FEE_KEY, pct, 'SumUp-Gebühr in % (für das Bank-Soll)');
    }
    return this.getSettings();
  }

  /**
   * Zählung anlegen; Ist-Betrag wird serverseitig aus der Stückelung berechnet.
   * isOpening: Anfangsbestand beim Start – Soll = Ist, keine Differenz. Ohne Stückelung darf dann
   * auch nur ein Betrag (amount) übergeben werden.
   */
  async createCount({ denominations, note, userId, isOpening = false, amount }) {
    if (!userId) throw new Error('Benutzer fehlt');
    // Anfangsbestand nur, solange es noch keine Zählung gibt – sonst ließe sich ein Fehlbetrag „wegbuchen“
    if (isOpening && await prisma.cashCount.count() > 0) {
      throw new Error('Anfangsbestand nicht möglich: Es gibt schon eine Kassenzählung. Bitte normal zählen.');
    }
    const normalized = this.normalizeDenominations(denominations || {});
    let countedTotal = this.sumDenominations(normalized);
    if (isOpening && countedTotal === 0 && amount !== undefined && amount !== null && amount !== '') {
      countedTotal = round2(Number(String(amount).replace(',', '.')));
      if (!Number.isFinite(countedTotal) || countedTotal < 0) throw new Error('Anfangsbestand muss ein Betrag ab 0 € sein');
    }
    const countedAt = new Date();

    const computed = await this.getExpectedCash(undefined, countedAt);
    const expected = isOpening ? { ...computed, expectedTotal: countedTotal } : computed;
    const difference = isOpening ? 0 : round2(countedTotal - expected.expectedTotal);

    const breakdown = {
      isOpening: !!isOpening,
      computedExpected: computed.expectedTotal, // was die App ohne Anfangsbestand erwartet hätte
      hasBaseline: expected.hasBaseline,
      baseline: expected.baseline,
      since: expected.since,
      cashSales: expected.cashSales,
      cashRefunds: expected.cashRefunds,
      cashTopUps: expected.cashTopUps,
      cashExpenses: expected.cashExpenses,
      cashInvoices: expected.cashInvoices,
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
          isOpening: !!isOpening,
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
          action: isOpening ? 'CASH_OPENING' : 'CASH_COUNT',
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
