// services/yearEndExtrasService.js
//
// Zusatzdaten für den Jahresabschluss (Snapshot ab version 4), damit die
// Kassenprüfung alles Prüfrelevante in einem Bericht hat:
//   - cashCounts       alle Kassenzählungen im Abschlussfenster (nicht nur die letzte)
//   - corrections      Stornos und Korrekturen im Geschäftsjahr
//   - guestBalances    Gästeguthaben je Kunde ZUM STICHTAG (nicht "jetzt") + Guthaben-Abstimmung
//   - liquidityBridge  Geldbestand Anfang → Ende (nur wenn sauber herleitbar, sonst Begründung)
//   - articleActive    aktiv-Flag je Artikel (für den Warenbestand im PDF)
//
// Nur lesende Abfragen. Alle Beträge sind Number, auf Cent gerundet.

const prisma = require('../utils/prisma');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

const dec = (n) => Number(n || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sumBy = (arr, sel) => round2((arr || []).reduce((a, r) => a + dec(sel(r)), 0));

// Listen im Snapshot begrenzen (das PDF zeigt ohnehin nur die ersten 40); Summen bleiben vollständig
const MAX_ITEMS = 300;

// Bestandsbewegungen, die automatisch aus Storno/Belegkorrektur entstehen (keine manuelle Korrektur)
const AUTO_STOCK_REASON = /^(Storno$|Storno Rechnung |Update von Rechnung |Rechnung .*Änderung\/Storno$|Korrektur Beleg |Storno\/Löschung Beleg )/;

class YearEndExtrasService {
  /** Kalenderfenster des Geschäftsjahres (wie die EÜR): Start 00:00, Ende 23:59:59.999 lokal */
  yearWindow(fy) {
    return { start: parseLocalDate(fy.startDate), end: endOfLocalDay(fy.endDate) };
  }

  /* ---------------- Kassenzählungen im Geschäftsjahr ---------------- */
  async getCashCounts(window) {
    const rows = await prisma.cashCount.findMany({
      where: { countedAt: { gte: window.start, lte: window.end } },
      orderBy: { countedAt: 'asc' },
      include: { user: { select: { name: true } } }
    });
    const items = rows.map(r => ({
      id: r.id,
      countedAt: r.countedAt,
      countedBy: r.user ? r.user.name : null,
      isOpening: !!r.isOpening,
      expectedTotal: round2(dec(r.expectedTotal)),
      countedTotal: round2(dec(r.countedTotal)),
      difference: round2(dec(r.difference)),
      note: r.note || null
    }));
    return {
      window: { start: window.start, end: window.end },
      count: items.length,
      totalDifference: sumBy(items.filter(i => !i.isOpening), i => i.difference),
      items
    };
  }

  /* ---------------- Stornos und Korrekturen ---------------- */
  async getCorrections(start, end) {
    const win = { gte: start, lte: end };
    const [refunds, topUpStornos, cmCancelled, stockRows] = await Promise.all([
      prisma.transaction.findMany({
        where: { type: 'REFUND', createdAt: win },
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true, nickname: true } },
          originalTransaction: { select: { id: true, type: true, createdAt: true, totalAmount: true } }
        }
      }),
      prisma.accountTopUp.findMany({
        where: { reference: { startsWith: 'STORNO:' }, createdAt: win },
        orderBy: { createdAt: 'asc' },
        include: { customer: { select: { name: true, nickname: true } } }
      }),
      prisma.cashMovement.findMany({
        where: { cancelled: true, OR: [{ cancelledAt: win }, { occurredAt: win }] },
        orderBy: { occurredAt: 'asc' },
        include: { user: { select: { name: true } } }
      }),
      prisma.stockMovement.findMany({
        where: { type: { in: ['CORRECTION', 'INVENTORY'] }, createdAt: win },
        orderBy: { createdAt: 'asc' },
        include: { article: { select: { name: true, unit: true } } }
      })
    ]);

    const custName = (c) => (c ? (c.nickname ? `${c.name} (${c.nickname})` : c.name) : null);

    // (a) Stornos von Verkäufen; mehrfach stornierte Originale kennzeichnen
    const perOriginal = new Map();
    refunds.forEach(r => { if (r.originalTransactionId) perOriginal.set(r.originalTransactionId, (perOriginal.get(r.originalTransactionId) || 0) + 1); });
    const saleRefunds = refunds.filter(r => r.originalTransaction && r.originalTransaction.type === 'SALE');
    const otherRefunds = refunds.filter(r => !(r.originalTransaction && r.originalTransaction.type === 'SALE'));
    const typeLabel = { SALE: 'Verkauf', REFUND: 'Stornobuchung', OWNER_USE: 'Eigenverbrauch', EXPIRED: 'Abgelaufen' };
    const mapRefund = (r) => ({
      id: r.id,
      originalId: r.originalTransactionId || null,
      originalType: r.originalTransaction ? r.originalTransaction.type : null,
      originalLabel: r.originalTransaction ? (typeLabel[r.originalTransaction.type] || r.originalTransaction.type) : 'ohne Original',
      originalAt: r.originalTransaction ? r.originalTransaction.createdAt : null,
      cancelledAt: r.createdAt,
      customer: custName(r.customer),
      paymentMethod: r.paymentMethod,
      // stornierter Betrag (positiv = Verkauf wurde zurückgenommen); Gegenbuchung ist -amount
      amount: round2(-dec(r.totalAmount)),
      cancelledBy: r.user ? r.user.name : null,
      multiple: r.originalTransactionId ? (perOriginal.get(r.originalTransactionId) || 0) > 1 : false
    });
    const saleItems = saleRefunds.map(mapRefund);
    const byPayment = {};
    saleItems.forEach(i => {
      const k = i.paymentMethod || 'UNKNOWN';
      byPayment[k] = byPayment[k] || { count: 0, total: 0 };
      byPayment[k].count += 1;
      byPayment[k].total = round2(byPayment[k].total + i.amount);
    });
    const cancelledSales = {
      count: saleItems.length,
      total: sumBy(saleItems, i => i.amount),
      byPayment,
      multipleCount: saleItems.filter(i => i.multiple).length,
      items: saleItems.slice(0, MAX_ITEMS)
    };
    const otherItems = otherRefunds.map(mapRefund);
    const otherCancellations = {
      count: otherItems.length,
      total: sumBy(otherItems, i => i.amount),
      items: otherItems.slice(0, MAX_ITEMS)
    };

    // (b) stornierte Aufladungen: Gegenbuchung mit Referenz STORNO:<id des Originals>
    const origIds = topUpStornos.map(t => String(t.reference).slice('STORNO:'.length)).filter(Boolean);
    const originals = origIds.length
      ? await prisma.accountTopUp.findMany({ where: { id: { in: origIds } }, select: { id: true, createdAt: true, amount: true, method: true } })
      : [];
    const origMap = new Map(originals.map(o => [o.id, o]));
    const tuItems = topUpStornos.map(t => {
      const o = origMap.get(String(t.reference).slice('STORNO:'.length));
      return {
        id: t.id,
        originalAt: o ? o.createdAt : null,
        cancelledAt: t.createdAt,
        customer: custName(t.customer),
        method: t.method,
        amount: round2(-dec(t.amount)) // stornierter Aufladebetrag (positiv)
      };
    });
    const cancelledTopUps = { count: tuItems.length, total: sumBy(tuItems, i => i.amount), items: tuItems.slice(0, MAX_ITEMS) };

    // (c) stornierte Kassenbewegungen
    const cancellerIds = [...new Set(cmCancelled.map(m => m.cancelledBy).filter(Boolean))];
    const users = cancellerIds.length
      ? await prisma.user.findMany({ where: { id: { in: cancellerIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u.name]));
    const cmItems = cmCancelled.map(m => ({
      id: m.id,
      type: m.type,
      occurredAt: m.occurredAt,
      cancelledAt: m.cancelledAt,
      amount: round2(dec(m.amount)),
      note: [m.bankAccount, m.note].filter(Boolean).join(' – ') || null,
      createdBy: m.user ? m.user.name : null,
      cancelledBy: m.cancelledBy ? (userMap.get(m.cancelledBy) || null) : null
    }));
    const cancelledCashMovements = { count: cmItems.length, total: sumBy(cmItems, i => i.amount), items: cmItems.slice(0, MAX_ITEMS) };

    // (d) manuelle Bestandskorrekturen (ohne automatische Storno-/Beleg-Korrekturen)
    const manual = stockRows.filter(s => !AUTO_STOCK_REASON.test(String(s.reason || '')));
    const scItems = manual.map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      type: s.type,
      article: s.article ? s.article.name : '—',
      unit: s.article ? s.article.unit : '',
      quantity: Number(s.quantity || 0),
      reason: s.reason || null
    }));
    const stockCorrections = { count: scItems.length, items: scItems.slice(0, MAX_ITEMS) };

    return { cancelledSales, otherCancellations, cancelledTopUps, cancelledCashMovements, stockCorrections };
  }

  /* ---------------- Gästeguthaben zum Stichtag + Abstimmung ---------------- */
  /**
   * Stichtag = Ende des Geschäftsjahres (lokal). Liegt er in der Zukunft, gilt "Stand heute".
   *
   * Guthaben je Kunde zum Stichtag = aktuelles Guthaben
   *   − Aufladungen nach dem Stichtag (alle Methoden, auch Gegenbuchungen)
   *   + Kundenkonto-Buchungen nach dem Stichtag (SALE belastet, REFUND schreibt gut: Wirkung = −totalAmount)
   *
   * Abstimmung (aus den Buchungen, unabhängig von Customer.balance):
   *   Guthaben zu Beginn (alle Buchungen vor dem Start) + Bewegungen im Jahr = Guthaben laut Buchungen.
   *   Eine Abweichung zur Summe der Einzelkonten heißt: Kontostände wurden außerhalb der Buchungen verändert.
   */
  async getGuestBalances(start, stichtag) {
    const now = new Date();
    const asOfIsNow = stichtag > now;
    const asOf = asOfIsNow ? now : stichtag;
    const acc = { paymentMethod: 'ACCOUNT', customerId: { not: null } };

    const [customers, tuAfter, txAfter, tuUpto, txUpto, tuBefore, txBefore, tuYearAll, tuYearStorno, txYear] = await Promise.all([
      prisma.customer.findMany({ select: { id: true, name: true, nickname: true, balance: true, active: true }, orderBy: { name: 'asc' } }),
      prisma.accountTopUp.groupBy({ by: ['customerId'], where: { createdAt: { gt: asOf } }, _sum: { amount: true } }),
      prisma.transaction.groupBy({ by: ['customerId'], where: { ...acc, createdAt: { gt: asOf } }, _sum: { totalAmount: true } }),
      prisma.accountTopUp.groupBy({ by: ['customerId'], where: { createdAt: { lte: asOf } }, _sum: { amount: true } }),
      prisma.transaction.groupBy({ by: ['customerId'], where: { ...acc, createdAt: { lte: asOf } }, _sum: { totalAmount: true } }),
      prisma.accountTopUp.aggregate({ where: { createdAt: { lt: start } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { ...acc, createdAt: { lt: start } }, _sum: { totalAmount: true } }),
      prisma.accountTopUp.groupBy({ by: ['method'], where: { createdAt: { gte: start, lte: asOf } }, _sum: { amount: true }, _count: true }),
      prisma.accountTopUp.groupBy({ by: ['method'], where: { createdAt: { gte: start, lte: asOf }, reference: { startsWith: 'STORNO:' } }, _sum: { amount: true }, _count: true }),
      prisma.transaction.groupBy({ by: ['type', 'cancelled'], where: { ...acc, createdAt: { gte: start, lte: asOf } }, _sum: { totalAmount: true }, _count: true })
    ]);

    const toMap = (rows, field) => new Map(rows.map(r => [r.customerId, dec(r._sum[field])]));
    const mTuAfter = toMap(tuAfter, 'amount');
    const mTxAfter = toMap(txAfter, 'totalAmount');
    const mTuUpto = toMap(tuUpto, 'amount');
    const mTxUpto = toMap(txUpto, 'totalAmount');

    const all = customers.map(c => {
      const balance = round2(dec(c.balance) - (mTuAfter.get(c.id) || 0) + (mTxAfter.get(c.id) || 0));
      const ledger = round2((mTuUpto.get(c.id) || 0) - (mTxUpto.get(c.id) || 0));
      return { customerId: c.id, name: c.name, nickname: c.nickname, active: c.active, balance, ledger };
    });
    const withBalance = all.filter(c => Math.abs(c.balance) >= 0.005);
    const customerBalances = withBalance.map(({ customerId, name, nickname, balance }) => ({ customerId, name, nickname, balance }));
    const credit = sumBy(withBalance.filter(c => c.balance > 0), c => c.balance);
    const debit = sumBy(withBalance.filter(c => c.balance < 0), c => c.balance); // negativ
    const net = round2(credit + debit);

    // Bewegungen im Jahr
    const byMethod = (rows, m) => {
      const r = rows.find(x => x.method === m);
      return { total: round2(dec(r && r._sum.amount)), count: (r && r._count) || 0 };
    };
    const methods = ['CASH', 'TRANSFER', 'CARD', 'REIMBURSEMENT', 'MIGRATION'];
    const topUps = {};
    methods.forEach(m => {
      const allM = byMethod(tuYearAll, m), st = byMethod(tuYearStorno, m);
      topUps[m] = { total: round2(allM.total - st.total), count: allM.count - st.count };
    });
    const stornoTotal = round2(methods.reduce((a, m) => a + byMethod(tuYearStorno, m).total, 0)); // negativ
    const stornoCount = methods.reduce((a, m) => a + byMethod(tuYearStorno, m).count, 0);
    const txAgg = (type, cancelled) => {
      const r = txYear.find(x => x.type === type && (cancelled === undefined || x.cancelled === cancelled));
      return { total: round2(dec(r && r._sum.totalAmount)), count: (r && r._count) || 0 };
    };
    const salesActive = txAgg('SALE', false);
    const salesCancelled = txAgg('SALE', true);
    const refundRows = txYear.filter(x => x.type === 'REFUND');
    const refunds = { total: round2(-refundRows.reduce((a, r) => a + dec(r._sum.totalAmount), 0)), count: refundRows.reduce((a, r) => a + (r._count || 0), 0) };
    // sonstige Kundenkonto-Buchungen (Eigenverbrauch/Abgelaufen haben 0 €, der Vollständigkeit halber)
    const otherRows = txYear.filter(x => x.type !== 'SALE' && x.type !== 'REFUND');
    const otherTx = { total: round2(-otherRows.reduce((a, r) => a + dec(r._sum.totalAmount), 0)), count: otherRows.reduce((a, r) => a + (r._count || 0), 0) };

    const opening = round2(dec(tuBefore._sum.amount) - dec(txBefore._sum.totalAmount));
    const movementsTotal = round2(
      methods.reduce((a, m) => a + topUps[m].total, 0) + stornoTotal
      - salesActive.total - salesCancelled.total + refunds.total + otherTx.total
    );
    const expectedEnd = round2(opening + movementsTotal);
    const accountsSum = sumBy(all, c => c.balance);
    const deviation = round2(accountsSum - expectedEnd);
    const deviations = all
      .filter(c => Math.abs(c.balance - c.ledger) >= 0.005)
      .map(c => ({ customerId: c.customerId, name: c.name, nickname: c.nickname, balance: c.balance, ledger: c.ledger, difference: round2(c.balance - c.ledger) }));

    return {
      stichtag,
      asOf,
      asOfIsNow,
      customerBalances,
      totals: { credit, debit, net, count: customerBalances.length },
      reconciliation: {
        opening,
        topUps,
        topUpStornos: { total: stornoTotal, count: stornoCount },
        accountSales: salesActive,
        accountSalesCancelled: salesCancelled,
        accountRefunds: refunds,
        otherAccountTx: otherTx,
        movementsTotal,
        expectedEnd,
        accountsSum,
        deviation,
        // ohne Übernahme (MIGRATION): Veränderung, die einem Geldfluss bzw. einer Auslage entspricht
        changeWithoutMigration: round2(movementsTotal - topUps.MIGRATION.total),
        deviations: deviations.slice(0, MAX_ITEMS),
        deviationsCount: deviations.length
      }
    };
  }

  /* ---------------- Geldbestand Anfang → Ende ---------------- */
  /**
   * Überleitung nur, wenn der Geldbestand zu Beginn sauber feststeht: unmittelbar
   * vorangehendes, abgeschlossenes Geschäftsjahr mit Kassenbestand und Bankkonten,
   * und die Bank-Abstimmung rechnet ebenfalls ab diesem Abschluss. Sonst nur Begründung.
   */
  async getLiquidityBridge(fy, { profit, guestBalances, bankRecon, cashCount, cashCounts, bankAccounts, draft }) {
    const { start } = this.yearWindow(fy);
    const prev = await prisma.fiscalYear.findFirst({
      where: { closed: true, endDate: { lt: start }, report: { isNot: null } },
      orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
      include: { report: { select: { cashOnHand: true, bankAccountsJson: true } } }
    });
    const reasons = [];
    const consecutive = prev && (endOfLocalDay(prev.endDate).getTime() + 1 === start.getTime());
    const prevBanks = prev && Array.isArray(prev.report?.bankAccountsJson) ? prev.report.bankAccountsJson : [];
    const openingCount = (cashCounts?.items || []).find(c => c.isOpening);

    if (!prev) reasons.push('Es gibt keinen abgeschlossenen Vorjahresabschluss, aus dem Kassen- und Bankbestand zu Beginn hervorgehen.');
    else if (!consecutive) reasons.push(`Der letzte Abschluss („${prev.name}“) endet nicht unmittelbar vor diesem Geschäftsjahr.`);
    else if (!prevBanks.length) reasons.push(`Im Abschluss „${prev.name}“ sind keine Bankkonten erfasst.`);
    if (openingCount) reasons.push(`Die Kasse startet mit einem Anfangsbestand vom ${fmt(openingCount.countedAt)} (${eur(openingCount.countedTotal)}), nicht zum Beginn des Geschäftsjahres.`);
    if (bankRecon && bankRecon.openingSource === 'ANFANGSSTAND') {
      reasons.push(`Die Bank startet mit einem Anfangsstand vom ${fmt(bankRecon.openingBalance?.date)} (${eur(bankRecon.openingBalance?.total)}), nicht zum Beginn des Geschäftsjahres.`);
    }
    if (reasons.length) {
      return {
        available: false,
        reasons,
        explanation: 'Die Einnahmen-Überschuss-Rechnung umfasst das ganze Geschäftsjahr, der Geldbestand zu Beginn ist aber nicht für denselben Zeitpunkt erfasst. '
          + 'Eine Überleitung vom Überschuss zum Geldbestand wäre deshalb nicht belastbar und entfällt. '
          + 'Kasse und Bank sind stattdessen einzeln abgestimmt: Kasse über die Kassenzählungen (Soll/Ist), Bank über die Bank-Abstimmung (Soll/Ist).'
      };
    }

    const cashStart = round2(dec(prev.report.cashOnHand));
    const bankStart = sumBy(prevBanks, b => b.balance);
    const startTotal = round2(cashStart + bankStart);
    const guestChange = guestBalances ? guestBalances.reconciliation.changeWithoutMigration : 0;
    const cardFees = round2(dec(bankRecon?.outflows?.cardFees?.total));
    const expectedEnd = round2(startTotal + dec(profit) + guestChange - cardFees);
    const cashEnd = cashCount ? round2(dec(cashCount.countedTotal)) : null;
    const banks = Array.isArray(bankAccounts) ? bankAccounts : [];
    const bankEnd = banks.length ? sumBy(banks, b => b.balance) : null;
    const actualEnd = cashEnd !== null && bankEnd !== null ? round2(cashEnd + bankEnd) : null;
    return {
      available: true,
      previousFiscalYear: { id: prev.id, name: prev.name, endDate: prev.endDate },
      cashStart, bankStart, startTotal,
      profit: round2(dec(profit)),
      guestChange,
      cardFees,
      expectedEnd,
      cashEnd,
      cashCountedAt: cashCount ? cashCount.countedAt : null,
      bankEnd,
      bankPending: bankEnd === null && !!draft,
      actualEnd,
      difference: actualEnd !== null ? round2(actualEnd - expectedEnd) : null,
      cashCountDifferences: cashCounts ? cashCounts.totalDifference : 0,
      bankDifference: bankRecon && bankRecon.difference != null && banks.length ? round2(dec(bankRecon.difference)) : null
    };
  }

  /* ---------------- alles für den Snapshot ---------------- */
  async build(fy, { profit, bankRecon, cashCount, bankAccounts, cashCountWindow, draft }) {
    const { start, end } = this.yearWindow(fy);
    const [cashCounts, corrections, guestBalances, articles] = await Promise.all([
      this.getCashCounts(cashCountWindow || { start, end }),
      this.getCorrections(start, end),
      this.getGuestBalances(start, end),
      prisma.article.findMany({ select: { id: true, active: true } })
    ]);
    const liquidityBridge = await this.getLiquidityBridge(fy, { profit, guestBalances, bankRecon, cashCount, cashCounts, bankAccounts, draft });
    return { cashCounts, corrections, guestBalances, liquidityBridge, articleActive: new Map(articles.map(a => [a.id, a.active])) };
  }
}

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function eur(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}

module.exports = new YearEndExtrasService();
