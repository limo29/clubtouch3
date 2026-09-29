const prisma = require('../utils/prisma');
const cashCountService = require('./cashCountService');
const cashMovementService = require('./cashMovementService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');

function dec(n) { return Number(n || 0); }
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sumBy = (arr, sel) => round2((arr || []).reduce((a, r) => a + dec(sel(r)), 0));
const fmtDateDE = (d) => d ? new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

class AccountingService {
  /**
   * EÜR für einen Zeitraum. EINE Funktion für UI, EÜR-PDF und Jahresabschluss.
   *
   * Einnahmen   = Verkäufe (Transaction SALE, cancelled=false; bar + Kundenkonto)
   *             + bezahlte Ausgangsrechnungen (Invoice PAID, paidAt im Zeitraum)
   *             + sonstige Bareinnahmen (CashMovement OTHER_INCOME, nicht storniert)
   * Ausgaben    = bezahlte Eingangsrechnungen (PurchaseDocument RECHNUNG, paid=true, documentDate im Zeitraum)
   *             + sonstige Barausgaben (CashMovement OTHER_EXPENSE, nicht storniert)
   * nonRevenue  = Eigenverbrauch (OWNER_USE) und Abgelaufen (EXPIRED): KEINE Einnahmen,
   *               nur Menge und Warenwert (Verkaufspreis) je Artikel
   * liquidity   = Aufladungen (Zufluss in die Kasse, aber Verbindlichkeit gegenüber den Gästen,
   *               kein Ertrag), Gästeguthaben zum Stichtag
   *             + Kassenbewegungen (DEPOSIT_TO_BANK/WITHDRAWAL_FROM_BANK: ergebnisneutral, nur Liquidität)
   *               als liquidity.cashMovements und liquidity.cashMovementItems
   * liabilities = offene Eingangsrechnungen, receivables = offene Ausgangsrechnungen
   *
   * Rückgabeform: `summary`/`details` bleiben abwärtskompatibel (ProfitLoss.js liest
   * summary.totalIncome/totalExpenses/profit, details.incomeByCategory/incomeByArticle/
   * expensesBySupplier/incomeByType/expiredItems/ownerUseItems). Neue Blöcke sind additiv.
   */
  async getProfitLoss(startDate, endDate) {
    // 'YYYY-MM-DD' lokal (00:00), nicht UTC; Endtag inklusive
    const start = parseLocalDate(startDate);
    const end = endOfLocalDay(endDate);

    const itemsByArticle = (type) => prisma.$queryRaw`
      SELECT a.id AS "articleId", a.name AS article, a.category AS category, a.unit AS unit,
             SUM(ti.quantity) AS quantity, SUM(ti."totalPrice") AS amount,
             SUM(ti.quantity * a.price) AS value
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      JOIN "Article" a ON ti."articleId" = a.id
      WHERE t."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND t."createdAt" <= (${end}::timestamptz AT TIME ZONE 'UTC')
        AND t.cancelled = false AND t.type = ${type}::"TransactionType"
      GROUP BY a.id, a.name, a.category, a.unit
      ORDER BY amount DESC, quantity DESC
    `;

    const [
      txCash, txAccount,
      incomeByCategoryRaw, soldRaw, expiredRaw, ownerUseRaw,
      expenseAgg, expensesBySupplierRaw, expenseDocsRaw,
      paidInvoicesRaw, unpaidInvoicesRaw, unpaidPurchaseDocsRaw,
      topUpsCashAgg, topUpsTransferAgg, guestBalanceAgg,
      cmSummarize
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'SALE', cancelled: false, paymentMethod: 'CASH', createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.transaction.aggregate({
        where: { type: 'SALE', cancelled: false, paymentMethod: 'ACCOUNT', createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT a.category AS category, SUM(ti."totalPrice") AS amount, SUM(ti.quantity) AS quantity
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND t."createdAt" <= (${end}::timestamptz AT TIME ZONE 'UTC')
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.category
        ORDER BY amount DESC
      `,
      itemsByArticle('SALE'),
      itemsByArticle('EXPIRED'),
      itemsByArticle('OWNER_USE'),
      prisma.purchaseDocument.aggregate({
        where: { type: 'RECHNUNG', paid: true, documentDate: { gte: start, lte: end } },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT "supplier" AS supplier, COUNT(*) AS count, SUM("totalAmount") AS amount
        FROM "PurchaseDocument"
        WHERE type='RECHNUNG' AND paid = true
          AND "documentDate" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND "documentDate" <= (${end}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY supplier
        ORDER BY amount DESC
      `,
      prisma.purchaseDocument.findMany({
        where: { type: 'RECHNUNG', paid: true, documentDate: { gte: start, lte: end } },
        orderBy: { documentDate: 'asc' },
        select: {
          id: true, documentNumber: true, supplier: true, documentDate: true, paidAt: true,
          paymentMethod: true, totalAmount: true, nachweisUrl: true, paid: true, description: true
        }
      }),
      prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: { gte: start, lte: end } },
        orderBy: { paidAt: 'asc' },
        select: { id: true, invoiceNumber: true, customerName: true, description: true, paidAt: true, totalAmount: true }
      }),
      // Forderungen: offene Ausgangsrechnungen (SENT/DRAFT), Stichtag = Zeitraumende
      prisma.invoice.findMany({
        where: { status: { in: ['DRAFT', 'SENT'] }, createdAt: { lte: end } },
        orderBy: { dueDate: 'asc' },
        select: { id: true, invoiceNumber: true, customerName: true, description: true, createdAt: true, dueDate: true, status: true, totalAmount: true }
      }),
      // Verbindlichkeiten: offene Eingangsrechnungen, Stichtag = Zeitraumende
      prisma.purchaseDocument.findMany({
        where: { type: 'RECHNUNG', paid: false, documentDate: { lte: end } },
        orderBy: { documentDate: 'asc' },
        select: { id: true, documentNumber: true, supplier: true, documentDate: true, dueDate: true, totalAmount: true, nachweisUrl: true, description: true }
      }),
      prisma.accountTopUp.aggregate({
        where: { method: 'CASH', createdAt: { gte: start, lte: end } },
        _sum: { amount: true }, _count: true
      }),
      prisma.accountTopUp.aggregate({
        where: { method: 'TRANSFER', createdAt: { gte: start, lte: end } },
        _sum: { amount: true }, _count: true
      }),
      prisma.customer.aggregate({ _sum: { balance: true } }),
      cashMovementService.summarize({ gte: start, lte: end })
    ]);

    const mapArticleRows = (rows) => (rows || []).map(r => ({
      articleId: r.articleId,
      article: r.article || '—',
      category: r.category || '—',
      unit: r.unit || '',
      quantity: Number(r.quantity || 0),
      amount: round2(Number(r.amount || 0)),   // gebuchter Betrag (bei OWNER_USE/EXPIRED immer 0)
      value: round2(Number(r.value || 0))      // Warenwert zum aktuellen Verkaufspreis
    }));

    const soldArticles = mapArticleRows(soldRaw);
    const expiredItems = mapArticleRows(expiredRaw);
    const ownerUseItems = mapArticleRows(ownerUseRaw);

    const incomeCash = round2(dec(txCash._sum.totalAmount));
    const incomeAccount = round2(dec(txAccount._sum.totalAmount));
    const incomeSales = round2(incomeCash + incomeAccount);
    const paidInvoices = (paidInvoicesRaw || []).map(r => ({ ...r, totalAmount: dec(r.totalAmount) }));
    const incomeInvoices = sumBy(paidInvoices, r => r.totalAmount);

    // Einnahmen und Ausgaben aus Kassenbewegungen (CashMovement)
    const cmOtherIncome = cmSummarize.otherIncome;    // OTHER_INCOME: Betriebseinnahme
    const cmOtherExpense = cmSummarize.otherExpense;  // OTHER_EXPENSE: Betriebsausgabe

    const incomeTotal = round2(incomeSales + incomeInvoices + cmOtherIncome.total);
    const expensesFromDocs = round2(dec(expenseAgg._sum.totalAmount)); // nur Belege (für expensesByType)
    const expensesTotal = round2(expensesFromDocs + cmOtherExpense.total);
    const profit = round2(incomeTotal - expensesTotal);

    const expenseDocs = (expenseDocsRaw || []).map(r => ({ ...r, totalAmount: dec(r.totalAmount) }));
    const unpaidInvoices = (unpaidInvoicesRaw || []).map(r => ({ ...r, totalAmount: dec(r.totalAmount) }));
    const unpaidPurchaseDocs = (unpaidPurchaseDocsRaw || []).map(r => ({ ...r, totalAmount: dec(r.totalAmount) }));

    // expensesBySupplier: Beleglieferanten + ggf. Zeile für sonstige Barausgaben
    const expensesBySupplierBase = (expensesBySupplierRaw || []).map(r => ({
      supplier: r.supplier || '—', count: Number(r.count || 0), amount: round2(Number(r.amount || 0))
    }));
    const expensesBySupplier = cmOtherExpense.total > 0
      ? [...expensesBySupplierBase, { supplier: 'Sonstige Barausgaben (ohne Beleg)', count: cmOtherExpense.count, amount: cmOtherExpense.total, synthetic: true }]
      : expensesBySupplierBase;

    const topUpsCash = round2(dec(topUpsCashAgg._sum.amount));
    const topUpsTransfer = round2(dec(topUpsTransferAgg._sum.amount));

    return {
      period: { startDate: start, endDate: end, label: `${fmtDateDE(start)} – ${fmtDateDE(end)}` },

      summary: {
        totalIncome: incomeTotal,
        totalExpenses: expensesTotal,
        profit,
        // Abwärtskompatibel: Eigenverbrauch ist KEINE Einnahme mehr (war immer 0 €, da totalAmount 0).
        incomeOwnerUse: 0
      },

      details: {
        incomeByCategory: (incomeByCategoryRaw || []).map(r => ({
          category: r.category || '—', amount: round2(Number(r.amount || 0)), quantity: Number(r.quantity || 0)
        })),
        incomeByArticle: soldArticles,
        expensesBySupplier,
        incomeByType: {
          transactions: incomeSales,
          cash: incomeCash,
          account: incomeAccount,
          invoices: incomeInvoices,
          ownerUse: 0, // bleibt für alte Clients, siehe nonRevenue
          otherCash: cmOtherIncome.total  // sonstige Bareinnahmen
        },
        // Ausgaben aufgeteilt: Belege und sonstige Barausgaben
        expensesByType: {
          purchaseDocuments: expensesFromDocs,
          otherCash: cmOtherExpense.total
        },
        transactionCounts: { cash: txCash._count || 0, account: txAccount._count || 0 },
        expiredItems,
        ownerUseItems,
        paidInvoices,
        expenseDocs,
        // Kassenbewegungen mit Betragsdetails (für PDF)
        otherIncome: cmOtherIncome,
        otherExpense: cmOtherExpense
      },

      // Kein Ertrag: Sachentnahme und Schwund, bewertet zum Verkaufspreis
      nonRevenue: {
        ownerUse: { quantity: sumBy(ownerUseItems, r => r.quantity), value: sumBy(ownerUseItems, r => r.value), items: ownerUseItems },
        expired: { quantity: sumBy(expiredItems, r => r.quantity), value: sumBy(expiredItems, r => r.value), items: expiredItems }
      },

      // Liquidität: Aufladungen fließen in die Kasse, sind aber Verbindlichkeit gegenüber den Gästen
      liquidity: {
        topUps: {
          total: round2(topUpsCash + topUpsTransfer),
          cash: topUpsCash,
          transfer: topUpsTransfer,
          count: (topUpsCashAgg._count || 0) + (topUpsTransferAgg._count || 0)
        },
        guestBalanceEnd: round2(dec(guestBalanceAgg._sum.balance)),
        // Kassenbewegungen: Kasse ↔ Bank (ergebnisneutral) und sonstige Bar-Posten (in EÜR)
        cashMovements: {
          bankDeposits: { total: cmSummarize.bankDeposits.total, count: cmSummarize.bankDeposits.count },
          bankWithdrawals: { total: cmSummarize.bankWithdrawals.total, count: cmSummarize.bankWithdrawals.count },
          otherIncome: { total: cmOtherIncome.total, count: cmOtherIncome.count },
          otherExpense: { total: cmOtherExpense.total, count: cmOtherExpense.count }
        },
        cashMovementItems: cmSummarize.items
      },

      liabilities: {
        unpaidPurchaseDocuments: {
          total: sumBy(unpaidPurchaseDocs, r => r.totalAmount),
          count: unpaidPurchaseDocs.length,
          items: unpaidPurchaseDocs
        }
      },

      receivables: {
        unpaidInvoices: {
          total: sumBy(unpaidInvoices, r => r.totalAmount),
          count: unpaidInvoices.length,
          items: unpaidInvoices
        }
      }
    };
  }

  /**
   * Bank-Abstimmung für einen Zeitraum (Kassenprüfer-Sicht).
   *
   *   Eröffnung  = Summe der Bankkonten aus dem letzten ABGESCHLOSSENEN Geschäftsjahr,
   *                dessen Ende vor dem Zeitraum liegt (openingSource VORJAHRESABSCHLUSS),
   *                sonst 0 (KEIN_VORJAHR)
   *   + Einzahlungen aus der Kasse      (CashMovement DEPOSIT_TO_BANK, nicht storniert)
   *   + Aufladungen per Überweisung     (AccountTopUp.method = TRANSFER)
   *   + bezahlte Ausgangsrechnungen     (Invoice PAID, paidAt im Zeitraum; es gibt keine Zahlungsart,
   *                                      Ausgangsrechnungen gelten als Bankeingang)
   *   - per Überweisung bezahlte Einkäufe (PurchaseDocument RECHNUNG, paid, paymentMethod TRANSFER,
   *                                      paidAt-Fallback documentDate wie in cashCountService)
   *   - Abhebungen für die Kasse        (CashMovement WITHDRAWAL_FROM_BANK, nicht storniert)
   *   = Bank-Soll (expected)
   *
   * Nicht enthalten (läuft nicht durch die App): Bankgebühren, Zinsen, Mitgliedsbeiträge, Spenden.
   * Alle Beträge sind Number; movements sind nach Datum aufsteigend sortiert, amount signiert.
   */
  async getBankReconciliation(startDate, endDate) {
    const start = parseLocalDate(startDate);
    const end = endOfLocalDay(endDate);
    const window = { gte: start, lte: end };

    const [prevYear, cm, topUps, invoices, purchases, cashInvoicesAgg] = await Promise.all([
      prisma.fiscalYear.findFirst({
        where: { closed: true, endDate: { lt: start }, report: { isNot: null } },
        orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
        include: { report: { select: { bankAccountsJson: true, createdAt: true } } }
      }),
      cashMovementService.summarize(window),
      prisma.accountTopUp.findMany({
        where: { method: 'TRANSFER', createdAt: window },
        orderBy: { createdAt: 'asc' },
        select: { id: true, amount: true, reference: true, createdAt: true, customer: { select: { name: true } } }
      }),
      // Kundenrechnungen per Überweisung (null = Altbestand ohne Zahlungsart, gilt als Bank);
      // bar bezahlte laufen über die Kasse (cashCountService) und werden hier nur nachrichtlich gezählt
      prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: window, OR: [{ paymentMethod: 'TRANSFER' }, { paymentMethod: null }] },
        orderBy: { paidAt: 'asc' },
        select: { id: true, invoiceNumber: true, customerName: true, description: true, paidAt: true, totalAmount: true, paymentMethod: true }
      }),
      prisma.purchaseDocument.findMany({
        where: {
          type: 'RECHNUNG', paid: true, paymentMethod: 'TRANSFER',
          OR: [{ paidAt: window }, { paidAt: null, documentDate: window }]
        },
        orderBy: { documentDate: 'asc' },
        select: { id: true, documentNumber: true, supplier: true, description: true, paidAt: true, documentDate: true, totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { status: 'PAID', paymentMethod: 'CASH', paidAt: window },
        _sum: { totalAmount: true }, _count: true
      })
    ]);

    const prevBanks = prevYear && Array.isArray(prevYear.report?.bankAccountsJson) ? prevYear.report.bankAccountsJson : [];
    const opening = sumBy(prevBanks, b => b.balance);
    const openingSource = prevYear ? 'VORJAHRESABSCHLUSS' : 'KEIN_VORJAHR';

    const movements = [];
    cm.bankDeposits.items.forEach(m => movements.push({
      id: m.id, date: m.occurredAt, kind: 'DEPOSIT_TO_BANK', label: 'Einzahlung aus der Kasse',
      reference: [m.bankAccount, m.note].filter(Boolean).join(' - ') || null, amount: round2(dec(m.amount))
    }));
    cm.bankWithdrawals.items.forEach(m => movements.push({
      id: m.id, date: m.occurredAt, kind: 'WITHDRAWAL_FROM_BANK', label: 'Abhebung für die Kasse',
      reference: [m.bankAccount, m.note].filter(Boolean).join(' - ') || null, amount: round2(-dec(m.amount))
    }));
    topUps.forEach(t => movements.push({
      id: t.id, date: t.createdAt, kind: 'TOPUP_TRANSFER', label: `Aufladung per Überweisung${t.customer?.name ? ` (${t.customer.name})` : ''}`,
      reference: t.reference || null, amount: round2(dec(t.amount))
    }));
    invoices.forEach(i => movements.push({
      id: i.id, date: i.paidAt, kind: 'INVOICE_PAID', label: `Kundenrechnung per Überweisung${i.paymentMethod ? '' : ' (Altbestand ohne Zahlungsart)'}${i.customerName ? ` (${i.customerName})` : ''}`,
      reference: i.invoiceNumber || null, amount: round2(dec(i.totalAmount))
    }));
    purchases.forEach(p => movements.push({
      id: p.id, date: p.paidAt || p.documentDate, kind: 'PURCHASE_TRANSFER', label: `Einkauf per Überweisung${p.supplier ? ` (${p.supplier})` : ''}`,
      reference: p.documentNumber || null, amount: round2(-dec(p.totalAmount))
    }));
    movements.sort((a, b) => new Date(a.date) - new Date(b.date));

    const inflows = {
      bankDeposits: { total: cm.bankDeposits.total, count: cm.bankDeposits.count },
      topUpsTransfer: { total: sumBy(topUps, t => t.amount), count: topUps.length },
      invoicesPaid: { total: sumBy(invoices, i => i.totalAmount), count: invoices.length }
    };
    // Nachrichtlich: bar bezahlte Kundenrechnungen laufen über die Kasse, nicht über die Bank
    const invoicesPaidCash = {
      total: round2(dec(cashInvoicesAgg._sum.totalAmount)),
      count: cashInvoicesAgg._count || 0
    };
    const outflows = {
      purchasesTransfer: { total: sumBy(purchases, p => p.totalAmount), count: purchases.length },
      bankWithdrawals: { total: cm.bankWithdrawals.total, count: cm.bankWithdrawals.count }
    };
    const inflowTotal = round2(inflows.bankDeposits.total + inflows.topUpsTransfer.total + inflows.invoicesPaid.total);
    const outflowTotal = round2(outflows.purchasesTransfer.total + outflows.bankWithdrawals.total);

    return {
      period: { startDate: start, endDate: end, label: `${fmtDateDE(start)} - ${fmtDateDE(end)}` },
      opening,
      openingSource,
      openingFiscalYear: prevYear ? { id: prevYear.id, name: prevYear.name, endDate: prevYear.endDate, accounts: prevBanks } : null,
      inflows,
      outflows,
      invoicesPaidCash,
      inflowTotal,
      outflowTotal,
      expected: round2(opening + inflowTotal - outflowTotal),
      movements,
      notCovered: 'Nicht enthalten: Bankgebühren, Zinsen, Mitgliedsbeiträge, Spenden und alles, was nicht über die App gebucht wurde. Bar bezahlte Kundenrechnungen laufen über die Kasse.'
    };
  }

  /** Bank-Abstimmung inkl. Ist/Differenz aus erfassten Kontoständen (für Snapshot und Abschluss). */
  _withActual(recon, bankAccounts) {
    const actual = sumBy(bankAccounts || [], b => b.balance);
    return { ...recon, actual, difference: round2(actual - recon.expected) };
  }

  /** Liste Geschäftsjahre */
  async listFiscalYears() {
    return prisma.fiscalYear.findMany({
      include: { report: true },
      orderBy: [{ startDate: 'desc' }]
    });
  }

  /** Geschäftsjahr anlegen */
  async createFiscalYear({ name, startDate, endDate }) {
    if (!name || !startDate || !endDate) throw new Error('Name, Start- und Enddatum sind erforderlich');
    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    if (!start || !end) throw new Error('Ungültiges Datum');
    if (end < start) throw new Error('Enddatum liegt vor dem Startdatum');
    return prisma.fiscalYear.create({ data: { name, startDate: start, endDate: end } });
  }

  /** Aktueller Systembestand als Snapshot-Zeilen */
  async _inventorySystemSnapshot() {
    const articles = await prisma.article.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    return articles.map(a => ({
      articleId: a.id, name: a.name, category: a.category, unit: a.unit,
      systemStock: Number(a.stock || 0),
      stock: Number(a.stock || 0), // Alias für die Vorschau-Tabelle im Frontend
      price: Number(a.price || 0),
      value: round2(Number(a.stock || 0) * Number(a.price || 0)),
      purchaseUnit: a.purchaseUnit,
      unitsPerPurchase: Number(a.unitsPerPurchase || 0)
    }));
  }

  /**
   * Zählfenster für den Abschluss: [startDate 00:00, endDate + 1 Tag 23:59:59].
   * Der Folgetag zählt mit, weil der Geschäftstag bis 06:00 morgens läuft und
   * die Kasse typischerweise am Morgen nach dem Stichtag gezählt wird.
   */
  _cashCountWindow(fy) {
    const start = parseLocalDate(fy.startDate);
    const end = endOfLocalDay(fy.endDate);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  /** Kassenzählung für den Abschluss auflösen (explizit per ID oder neueste im Fenster). */
  async _resolveCashCount(fy, cashCountId) {
    const { start, end } = this._cashCountWindow(fy);
    const stichtag = fmtDateDE(fy.endDate);
    const missing = `Bitte zuerst die Kasse zählen (Kassenzählung), spätestens zum Stichtag ${stichtag}`;

    if (cashCountId) {
      const cc = await cashCountService.getById(cashCountId);
      if (!cc) throw new Error('Kassenzählung nicht gefunden');
      const t = new Date(cc.countedAt);
      if (t < start || t > end) {
        throw new Error(`Die gewählte Kassenzählung vom ${fmtDateDE(t)} liegt außerhalb des Geschäftsjahres (${fmtDateDE(fy.startDate)} – ${stichtag})`);
      }
      return cc;
    }
    const cc = await cashCountService.getLatestInPeriod(start, end);
    if (!cc) throw new Error(missing);
    return cc;
  }

  /**
   * Abschluss-Snapshot bauen (gemeinsam für echten Abschluss und Entwurfs-PDF).
   * cashCount darf beim Entwurf null sein.
   */
  async _buildYearEndSnapshot(fy, { bankAccounts, physicalInventory, cashCount, draft = false }) {
    const [eur, system, bankRecon] = await Promise.all([
      this.getProfitLoss(fy.startDate, fy.endDate),
      this._inventorySystemSnapshot(),
      this.getBankReconciliation(fy.startDate, fy.endDate)
    ]);

    const physicalMap = new Map(
      (physicalInventory || []).map(x => [x.articleId, Number(x.physicalStock || 0)])
    );
    const inventoryPhysical = system.map(s => ({
      articleId: s.articleId, name: s.name, unit: s.unit,
      physicalStock: physicalMap.has(s.articleId) ? physicalMap.get(s.articleId) : s.systemStock,
      price: s.price,
      purchaseUnit: s.purchaseUnit, unitsPerPurchase: s.unitsPerPurchase
    }));
    const inventoryDiff = inventoryPhysical.map(p => {
      const sys = system.find(s => s.articleId === p.articleId);
      const diff = Number(p.physicalStock) - Number(sys.systemStock);
      return {
        articleId: p.articleId, name: p.name, unit: p.unit,
        systemStock: sys.systemStock, physicalStock: Number(p.physicalStock),
        diff, price: sys.price,
        systemValue: round2(sys.systemStock * sys.price),
        physicalValue: round2(Number(p.physicalStock) * sys.price),
        diffValue: round2(diff * sys.price),
        purchaseUnit: p.purchaseUnit, unitsPerPurchase: p.unitsPerPurchase
      };
    });

    const customers = await prisma.customer.findMany({
      where: { balance: { not: 0 } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nickname: true, balance: true }
    });
    const customerBalances = customers.map(c => ({
      customerId: c.id, name: c.name, nickname: c.nickname, balance: dec(c.balance)
    }));
    const guestBalance = sumBy(customerBalances, c => c.balance);

    const banks = Array.isArray(bankAccounts)
      ? bankAccounts.map(b => ({ name: b.name || '', iban: b.iban || '', balance: dec(b.balance) }))
      : [];

    return {
      version: 3,
      draft,
      closedAt: draft ? null : new Date(),
      generatedAt: new Date(),
      period: { startDate: fy.startDate, endDate: fy.endDate },
      summary: eur.summary,
      incomeByCategory: eur.details.incomeByCategory,
      incomeByType: eur.details.incomeByType,
      expensesBySupplier: eur.details.expensesBySupplier,
      expensesByType: eur.details.expensesByType,
      soldArticles: eur.details.incomeByArticle,
      paidInvoices: eur.details.paidInvoices,
      expenseDocs: eur.details.expenseDocs,
      unpaidInvoices: eur.receivables.unpaidInvoices.items,
      unpaidPurchaseDocs: eur.liabilities.unpaidPurchaseDocuments.items,
      expiredArticles: eur.nonRevenue.expired.items,
      ownerUseArticles: eur.nonRevenue.ownerUse.items,
      nonRevenue: {
        ownerUse: { quantity: eur.nonRevenue.ownerUse.quantity, value: eur.nonRevenue.ownerUse.value },
        expired: { quantity: eur.nonRevenue.expired.quantity, value: eur.nonRevenue.expired.value }
      },
      liquidity: { topUps: eur.liquidity.topUps, guestBalanceEnd: guestBalance },
      // Kassenbewegungen im Snapshot (für PDF); Altabschlüsse (v2) haben dieses Feld nicht
      cashMovements: {
        bankDeposits: eur.liquidity.cashMovements.bankDeposits,
        bankWithdrawals: eur.liquidity.cashMovements.bankWithdrawals,
        otherIncome: { ...eur.liquidity.cashMovements.otherIncome, items: eur.details.otherIncome.items },
        otherExpense: { ...eur.liquidity.cashMovements.otherExpense, items: eur.details.otherExpense.items },
        items: eur.liquidity.cashMovementItems
      },
      customerBalances,
      bankAccounts: banks,
      // Bank-Abstimmung (v3): Soll aus Vorjahresabschluss + Überweisungsbewegungen vs. erfasste Kontostände
      bankReconciliation: this._withActual(bankRecon, banks),
      cashCount: cashCount ? {
        id: cashCount.id,
        countedAt: cashCount.countedAt,
        countedTotal: dec(cashCount.countedTotal),
        expectedTotal: dec(cashCount.expectedTotal),
        difference: dec(cashCount.difference),
        countedBy: cashCount.user ? cashCount.user.name : null,
        note: cashCount.note || null
      } : null,
      inventory: { system, physical: inventoryPhysical, diff: inventoryDiff }
    };
  }

  /**
   * Geschäftsjahr abschließen:
   *  - EÜR (getProfitLoss) für den Zeitraum
   *  - Kassenbestand aus der letzten Kassenzählung im Zeitraum (Pflicht, nicht manuell)
   *  - Systembestand snapshotten, Ist-Bestand (vom Client) mappen, Differenz berechnen
   *  - Bankkonten übernehmen, Gästeguthaben als Liste einfrieren
   *  - Alles in detailsJson, das PDF rendert später nur noch daraus
   */
  async closeFiscalYear(fiscalYearId, { bankAccounts, physicalInventory, cashCountId } = {}) {
    const fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!fy) throw new Error('Geschäftsjahr nicht gefunden');
    if (fy.closed) throw new Error('Geschäftsjahr bereits geschlossen');

    const cashCount = await this._resolveCashCount(fy, cashCountId);
    const detailsJson = await this._buildYearEndSnapshot(fy, { bankAccounts, physicalInventory, cashCount });

    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.yearEndReport.create({
        data: {
          fiscalYearId: fy.id,
          incomeTotal: detailsJson.summary.totalIncome,
          expensesTotal: detailsJson.summary.totalExpenses,
          profit: detailsJson.summary.profit,
          cashOnHand: detailsJson.cashCount.countedTotal,
          bankAccountsJson: detailsJson.bankAccounts,
          guestBalance: detailsJson.liquidity.guestBalanceEnd,
          inventorySystem: detailsJson.inventory.system,
          inventoryPhysical: detailsJson.inventory.physical,
          inventoryDiff: detailsJson.inventory.diff,
          detailsJson
        }
      });
      const updated = await tx.fiscalYear.update({ where: { id: fy.id }, data: { closed: true } });
      return { fiscalYear: updated, report };
    });

    return result;
  }

  /**
   * Datenbasis für das Jahresabschluss-PDF.
   *  - geschlossen: ausschließlich der eingefrorene Snapshot (detailsJson); alte Abschlüsse
   *    ohne detailsJson werden aus den Spalten des YearEndReport rekonstruiert (ohne Listen).
   *  - offen: Live-Entwurf in derselben Form (draft = true).
   */
  async getYearEndSnapshot(fiscalYearId) {
    const fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId }, include: { report: true } });
    if (!fy) throw new Error('Geschäftsjahr nicht gefunden');

    if (!fy.closed) {
      const { start, end } = this._cashCountWindow(fy);
      const cashCount = await cashCountService.getLatestInPeriod(start, end);
      const snapshot = await this._buildYearEndSnapshot(fy, { bankAccounts: [], physicalInventory: [], cashCount, draft: true });
      return { fiscalYear: fy, snapshot };
    }

    const report = fy.report;
    if (!report) throw new Error('Abschlussbericht nicht gefunden');
    const d = report.detailsJson && typeof report.detailsJson === 'object' ? report.detailsJson : {};
    if (d.version >= 2) {
      return { fiscalYear: fy, snapshot: { ...d, draft: false, closedAt: d.closedAt || report.createdAt } };
    }

    // Altbestand: Abschluss vor Einführung des Snapshots
    const system = Array.isArray(report.inventorySystem) ? report.inventorySystem : [];
    const physical = Array.isArray(report.inventoryPhysical) ? report.inventoryPhysical : [];
    const physMap = new Map(physical.map(x => [x.articleId || x.name, x]));
    const diff = system.map(s => {
      const p = physMap.get(s.articleId || s.name);
      const physicalStock = p ? Number(p.physicalStock || 0) : Number(s.systemStock || 0);
      const price = Number(s.price || 0);
      const dq = physicalStock - Number(s.systemStock || 0);
      return {
        articleId: s.articleId, name: s.name, unit: s.unit,
        systemStock: Number(s.systemStock || 0), physicalStock, diff: dq, price,
        systemValue: round2(Number(s.systemStock || 0) * price),
        physicalValue: round2(physicalStock * price), diffValue: round2(dq * price),
        purchaseUnit: s.purchaseUnit, unitsPerPurchase: Number(s.unitsPerPurchase || 0)
      };
    });
    return {
      fiscalYear: fy,
      snapshot: {
        version: 1, draft: false, legacy: true,
        closedAt: report.createdAt,
        period: { startDate: fy.startDate, endDate: fy.endDate },
        summary: { totalIncome: dec(report.incomeTotal), totalExpenses: dec(report.expensesTotal), profit: dec(report.profit) },
        incomeByCategory: [], incomeByType: null, expensesBySupplier: [],
        soldArticles: [], paidInvoices: [], expenseDocs: [], unpaidInvoices: [], unpaidPurchaseDocs: [],
        expiredArticles: [], ownerUseArticles: [],
        nonRevenue: null, liquidity: { topUps: null, guestBalanceEnd: dec(report.guestBalance) },
        customerBalances: [],
        bankAccounts: Array.isArray(report.bankAccountsJson) ? report.bankAccountsJson : [],
        cashCount: { id: null, countedAt: null, countedTotal: dec(report.cashOnHand), expectedTotal: null, difference: null, countedBy: null, manual: true },
        inventory: { system, physical, diff }
      }
    };
  }

  /** Ein einzelner Bericht (für PDF) */
  async getYearEndReport(fiscalYearId) {
    return prisma.yearEndReport.findFirst({
      where: { fiscalYearId },
      include: { fiscalYear: true }
    });
  }

  /**
   * Live-Vorschau für den Abschluss eines (offenen) Geschäftsjahres.
   * Datenbasis ist getProfitLoss, damit Vorschau, Abschluss und PDF dieselben Zahlen zeigen.
   * Rückgabe-Schlüssel bleiben für ProfitLoss.js stabil.
   */
  async getFiscalYearPreview(fiscalYearId) {
    const fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!fy) throw new Error('Geschäftsjahr nicht gefunden');

    const [eur, inventorySystem, bankReconciliation] = await Promise.all([
      this.getProfitLoss(fy.startDate, fy.endDate),
      this._inventorySystemSnapshot(),
      this.getBankReconciliation(fy.startDate, fy.endDate)
    ]);

    const { start, end } = this._cashCountWindow(fy);
    const cashCount = await cashCountService.getLatestInPeriod(start, end);

    return {
      fiscalYear: fy,
      summary: eur.summary,
      soldArticles: eur.details.incomeByArticle,
      paidInvoices: eur.details.paidInvoices,
      expenseDocs: eur.details.expenseDocs,
      unpaidInvoices: eur.receivables.unpaidInvoices.items,
      unpaidPurchaseDocs: eur.liabilities.unpaidPurchaseDocuments.items,
      expiredArticles: eur.nonRevenue.expired.items,
      ownerUseArticles: eur.nonRevenue.ownerUse.items,
      nonRevenue: eur.nonRevenue,
      liquidity: eur.liquidity,
      expensesByType: eur.details.expensesByType,
      cashMovements: {
        bankDeposits: eur.liquidity.cashMovements.bankDeposits,
        bankWithdrawals: eur.liquidity.cashMovements.bankWithdrawals,
        otherIncome: { ...eur.liquidity.cashMovements.otherIncome, items: eur.details.otherIncome.items },
        otherExpense: { ...eur.liquidity.cashMovements.otherExpense, items: eur.details.otherExpense.items },
        items: eur.liquidity.cashMovementItems
      },
      inventorySystem,
      bankReconciliation,
      cashCount: cashCount ? {
        id: cashCount.id, countedAt: cashCount.countedAt,
        countedTotal: cashCount.countedTotal, expectedTotal: cashCount.expectedTotal,
        difference: cashCount.difference, countedBy: cashCount.user ? cashCount.user.name : null
      } : null,
      cashCountRequired: !cashCount,
      cashCountWindow: { start, end }
    };
  }
}

module.exports = new AccountingService();
