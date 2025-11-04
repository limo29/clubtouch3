const prisma = require('../utils/prisma');

function dec(n) { return Number(n || 0); }

class AccountingService {
  /**
   * EÜR für Zeitraum (inkl. Details)
   * Einnahmen: Verkäufe (Transaction type='SALE', cancelled=false)
   *           (TopUps sind Einzahlung/Verbindl.-Tausch -> nicht als Ertrag gezählt)
   * Ausgaben: Eingangsrechnungen (PurchaseDocument type='RECHNUNG', paid=true, documentDate im Zeitraum)
   */
  async getProfitLoss(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Verkäufe (POS)
    const [txAgg, incomeByCategoryRaw, txCash, txAccount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: 'SALE', cancelled: false, createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT a.category as category, SUM(ti."totalPrice") as amount
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end}
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.category
        ORDER BY amount DESC
      `,
      prisma.transaction.aggregate({
        where: { type: 'SALE', cancelled: false, paymentMethod: 'CASH', createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }
      }),
      prisma.transaction.aggregate({
        where: { type: 'SALE', cancelled: false, paymentMethod: 'ACCOUNT', createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }
      }),
    ]);

    // Einnahmen nach Artikel (für Top-10 Chart)
    const incomeByArticleRaw = await prisma.$queryRaw`
      SELECT a.name as article, SUM(ti.quantity) as quantity, SUM(ti."totalPrice") as amount
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      JOIN "Article" a ON ti."articleId" = a.id
      WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end}
        AND t.cancelled = false AND t.type = 'SALE'
      GROUP BY a.id, a.name
      ORDER BY amount DESC
      LIMIT 50
    `;

    // Ausgaben (Eingangsrechnungen, bezahlt)
    const [invAgg, expensesBySupplierRaw] = await Promise.all([
      prisma.purchaseDocument.aggregate({
        where: { type: 'RECHNUNG', paid: true, documentDate: { gte: start, lte: end } },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT "supplier" as supplier, COUNT(*) as count, SUM("totalAmount") as amount
        FROM "PurchaseDocument"
        WHERE type='RECHNUNG' AND paid = true
          AND "documentDate" >= ${start} AND "documentDate" <= ${end}
        GROUP BY supplier
        ORDER BY amount DESC
      `
    ]);

    // Einnahmen aus bezahlten Ausgangsrechnungen
    const invoicesPaidAgg = await prisma.invoice.aggregate({
      where: { status: 'PAID', paidAt: { gte: start, lte: end } },
      _sum: { totalAmount: true },
      _count: true
    });

    const incomePOS = dec(txAgg._sum.totalAmount);
    const incomeInvoices = dec(invoicesPaidAgg._sum.totalAmount);
    const incomeTotal = incomePOS + incomeInvoices;

    const expensesTotal = dec(invAgg._sum.totalAmount);
    const profit = incomeTotal - expensesTotal;

    const incomeByCategory = incomeByCategoryRaw.map(r => ({
      category: r.category || '—',
      amount: Number(r.amount || 0)
    }));

    const incomeByArticle = incomeByArticleRaw.map(r => ({
      article: r.article || '—',
      quantity: Number(r.quantity || 0),
      amount: Number(r.amount || 0)
    }));

    const expensesBySupplier = expensesBySupplierRaw.map(r => ({
      supplier: r.supplier || '—',
      count: Number(r.count || 0),
      amount: Number(r.amount || 0)
    }));

    return {
      summary: {
        totalIncome: incomeTotal,
        totalExpenses: expensesTotal,
        profit
      },
      details: {
        incomeByCategory,
        incomeByArticle,           // <— neu
        expensesBySupplier,
        incomeByType: {
          transactions: dec(txCash._sum.totalAmount) + dec(txAccount._sum.totalAmount),
          invoices: incomeInvoices // <— neu
        }
      }
    };
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
    return prisma.fiscalYear.create({
      data: { name, startDate: new Date(startDate), endDate: new Date(endDate) }
    });
  }

  /**
   * Geschäftsjahr abschließen:
   *  - EÜR berechnen für Zeitraum
   *  - Systembestand snapshotten
   *  - Ist-Bestand (vom Client) mappen und Differenz berechnen
   *  - Barkasse & Bankkonten übernehmen
   *  - Kundenguthaben summieren
   */
  async closeFiscalYear(fiscalYearId, { cashOnHand, bankAccounts, physicalInventory }) {
    const fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!fy) throw new Error('Geschäftsjahr nicht gefunden');
    if (fy.closed) throw new Error('Geschäftsjahr bereits geschlossen');

    const eur = await this.getProfitLoss(fy.startDate, fy.endDate);

    const articles = await prisma.article.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }]
    });
    const system = articles.map(a => ({
      articleId: a.id, name: a.name, systemStock: Number(a.stock || 0), unit: a.unit
    }));

    const physicalMap = new Map(
      (physicalInventory || []).map(x => [x.articleId, Number(x.physicalStock || 0)])
    );

    const inventoryPhysical = system.map(s => ({
      articleId: s.articleId,
      name: s.name,
      physicalStock: physicalMap.has(s.articleId) ? physicalMap.get(s.articleId) : s.systemStock,
      unit: s.unit
    }));

    const diff = inventoryPhysical.map(p => {
      const sys = system.find(s => s.articleId === p.articleId);
      return {
        articleId: p.articleId,
        name: p.name,
        diff: Number(p.physicalStock) - Number(sys.systemStock),
        unit: p.unit
      };
    });

    const guestBalanceAgg = await prisma.customer.aggregate({
      _sum: { balance: true }
    });

    const report = await prisma.yearEndReport.create({
      data: {
        fiscalYearId: fy.id,
        incomeTotal: eur.summary.totalIncome,
        expensesTotal: eur.summary.totalExpenses,
        profit: eur.summary.profit,
        cashOnHand: Number(cashOnHand || 0),
        bankAccountsJson: bankAccounts ? bankAccounts : [],
        guestBalance: Number(guestBalanceAgg._sum.balance || 0),
        inventorySystem: system,
        inventoryPhysical: inventoryPhysical,
        inventoryDiff: diff
      }
    });

    await prisma.fiscalYear.update({
      where: { id: fy.id },
      data: { closed: true }
    });

    return { fiscalYear: { ...fy, closed: true }, report };
  }

  /** Ein einzelner Bericht (für PDF) */
  async getYearEndReport(fiscalYearId) {
    return prisma.yearEndReport.findFirst({
      where: { fiscalYearId },
      include: { fiscalYear: true }
    });
  }
  // Liefert alle Tabellen-Daten für die Abschluss-Preview eines Geschäftsjahres
 /**
   * Vorschau-Daten für einen Jahresabschluss (Zeitraum = Geschäftsjahr):
   * - Alle Einnahmen nach Artikel
   * - Bezahlte Ausgangsrechnungen
   * - Ausgaben (bezahlte Einkaufsrechnungen)
   * - Offene Ausgangsrechnungen (unbezahlt)
   */
  async getFiscalYearPreview(fiscalYearId) {
    const fy = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!fy) throw new Error('Geschäftsjahr nicht gefunden');

    const start = new Date(fy.startDate);
    const end = new Date(fy.endDate);
    end.setHours(23, 59, 59, 999);

    // Einnahmen nach Artikel
    const soldArticles = await prisma.$queryRaw`
      SELECT 
        a.id,
        a.name AS article,
        a.category,
        SUM(ti.quantity) AS quantity,
        SUM(ti."totalPrice") AS amount
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON ti."transactionId" = t.id
      LEFT JOIN "Article" a ON ti."articleId" = a.id
      WHERE t."createdAt" >= ${start}
        AND t."createdAt" <= ${end}
        AND t.cancelled = false
        AND t.type = 'SALE'
      GROUP BY a.id, a.name, a.category
      ORDER BY amount DESC
    `;

    // Bezahlte Ausgangsrechnungen (Erlöse aus AR)
    const paidInvoices = await prisma.invoice.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: start, lte: end }
      },
      select: { customerName: true, description: true, paidAt: true, totalAmount: true }
    });

    // Ausgaben: bezahlte Einkaufsrechnungen im Zeitraum
    const expenseDocs = await prisma.purchaseDocument.findMany({
      where: {
        type: 'RECHNUNG',
        paid: true,
        documentDate: { gte: start, lte: end }
      },
      select: { documentDate: true, supplier: true, documentNumber: true, totalAmount: true }
    });

    // Offene (unbezahlte) Ausgangsrechnungen im Zeitraum
    const unpaidInvoices = await prisma.invoice.findMany({
      where: {
        status: { not: 'PAID' },
        createdAt: { gte: start, lte: end }
      },
      select: { customerName: true, description: true, createdAt: true, dueDate: true, status: true, totalAmount: true }
    });

    return { soldArticles, paidInvoices, expenseDocs, unpaidInvoices };
  }

}

module.exports = new AccountingService();
