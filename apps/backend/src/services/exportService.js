// services/exportService.js
const { parse } = require('json2csv');
const PDFDocument = require('pdfkit');
const prisma = require('../utils/prisma');
const fs = require('fs').promises;
const path = require('path');
const accountingService = require('./accountingService');

class ExportService {
  constructor() {
    // Nutze /tmp statt /app
    this.exportDir = process.env.EXPORT_DIR || path.join('/tmp', 'exports');
    this.ensureExportDir();
    this.currencyFmt = new Intl.NumberFormat('de-DE', {
      style: 'currency', currency: 'EUR',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  async ensureExportDir() {
    try {
      await fs.mkdir(this.exportDir, { recursive: true });
    } catch (e) {
      console.error('Error creating export directory:', e);
    }
  }



  /* ========= THEME & UTIL ========= */
  getTheme() {
    return {
      brandName: 'Clubraum',
      page: { margin: 50, size: 'A4' },
      font: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
      color: {
        text: '#0f172a', subtext: '#475569',
        primary: '#2563eb', border: '#e2e8f0',
        tableHeaderBg: '#f1f5f9', tableHeaderText: '#334155',
        zebra: '#f8fafc', panelBg: '#f8fafc',
        success: '#16a34a', danger: '#dc2626'
      }
    };
  }
  _fmtEUR = (n) => this.currencyFmt.format(Number(n || 0));
  _fmtDate = (d) => d ? new Date(d).toLocaleDateString('de-DE') : '—';
  _fmtQty(n, unit, pUnit, pQty) {
    const val = Number(n || 0);
    const absVal = Math.abs(val);
    const sign = val < 0 ? '-' : '';

    // Bedingung: Keine Umrechnung definiert oder Total < 1 Einheit oder pQty nicht valide
    if (!pUnit || !pQty || pQty <= 1 || absVal < 1) {
      if (!unit) return val.toFixed(0);
      return `${val.toFixed(0)} ${unit}`;
    }

    const crates = Math.floor(absVal / pQty);
    const remainder = Number((absVal % pQty).toFixed(2));

    if (crates === 0) {
      return `${val.toFixed(0)} ${unit}`;
    }

    const parts = [];
    if (crates > 0) parts.push(`${crates} ${pUnit}`);
    if (remainder > 0) parts.push(`${remainder} ${unit}`);

    const human = parts.join(', ');
    return `${sign}${human} (${val.toFixed(0)})`;
  }

  _createDocWithBuffer() {
    const theme = this.getTheme();
    const doc = new PDFDocument({
      margin: theme.page.margin, size: theme.page.size, bufferPages: true
    });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
    return { doc, done, theme };
  }

  _decoratePage(doc, theme, { title, subtitle }) {
    this._lastHeaderInfo = { title, subtitle };
    const { margin } = theme.page;
    const pageWidth = doc.page.width;

    doc.save().lineWidth(1).strokeColor(theme.color.border)
      .moveTo(margin, margin - 15).lineTo(pageWidth - margin, margin - 15).stroke().restore();

    doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(18)
      .text(title || '', margin, margin - 40, { width: pageWidth - margin * 2, align: 'left' });

    if (subtitle) {
      doc.fillColor(theme.color.subtext).font(theme.font.regular).fontSize(10)
        .text(subtitle, { width: pageWidth - margin * 2, align: 'left' });
    }

    doc.y = theme.page.margin + 10;
    doc.x = theme.page.margin;
    doc.fillColor(theme.color.text).font(theme.font.regular);
  }

  _addPageDecorated(doc, theme, headerInfo) {
    doc.addPage();
    this._decoratePage(doc, theme, headerInfo);
  }



  _section(doc, theme, text) {
    doc.x = theme.page.margin;
    const bottom = doc.page.height - theme.page.margin;
    // Increased buffer to 100 to prevent headers at very bottom
    if (doc.y + 100 > bottom) this._addPageDecorated(doc, theme, this._lastHeaderInfo || {});
    doc.moveDown(0.6);
    doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
      .text(text, { width: doc.page.width - theme.page.margin * 2 });

    const x = theme.page.margin, y = doc.y + 2;
    const w = doc.page.width - theme.page.margin * 2;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor(this.getTheme().color.border).stroke();
    doc.moveDown(0.5);
    doc.font(theme.font.regular);
  }

  _table(doc, theme, { columns, rows, sumRow = null, emptyHint = 'Keine Daten vorhanden', headerInfo }) {
    const left = theme.page.margin;
    const right = doc.page.width - theme.page.margin;
    const usableWidth = right - left;

    const srcW = columns.map(c => c.width);
    const totalW = srcW.reduce((a, b) => a + b, 0) || 1;
    const scale = usableWidth / totalW;
    const widths = srcW.map(w => Math.floor(w * scale));
    const rowPad = 6;
    const headerH = 18;

    const renderHeader = () => {
      let x = left; const y = doc.y;
      doc.save().rect(left, y - rowPad, usableWidth, headerH + rowPad * 2).fill(theme.color.tableHeaderBg).restore();
      columns.forEach((col, idx) => {
        doc.fillColor(theme.color.tableHeaderText).font(this.getTheme().font.bold).fontSize(10)
          .text(col.header, x + 2, y, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });
      doc.moveTo(left, y + headerH + rowPad).lineTo(right, y + headerH + rowPad)
        .lineWidth(0.5).strokeColor(theme.color.border).stroke();
      doc.y = y + headerH + rowPad + 2;
      doc.fillColor(theme.color.text).font(theme.font.regular);
    };

    const ensureRoom = (need) => {
      const bottom = doc.page.height - theme.page.margin;
      if (doc.y + need > bottom) {
        if (doc.y < theme.page.margin + 50) {
          console.log(`[PDF WARN] Row too tall (${need}) for page. Printing anyway.`);
          return;
        }
        this._addPageDecorated(doc, theme, headerInfo || this._lastHeaderInfo || {});
        renderHeader();
      }
    };

    renderHeader();

    if (!rows || rows.length === 0) {
      ensureRoom(22);
      doc.fontSize(10).fillColor(theme.color.subtext).text(emptyHint, left, doc.y + 6);
      doc.moveDown(1); doc.x = theme.page.margin; return;
    }

    rows.forEach((row, i) => {
      // Zeilenhöhe bestimmen
      // FIX: Font explizit setzen, damit heightOfString korrekt misst
      doc.font(theme.font.regular).fontSize(10);
      const heights = columns.map((col, idx) => {
        const txt = col.render ? col.render(row) : (row[col.key] ?? '');
        return Math.max(doc.heightOfString(String(txt ?? ''), { width: widths[idx] - 4 }), 10);
      });
      const rowH = Math.max(...heights) + rowPad * 2;

      // FIX: Mehr Puffer für Seitenumbruch
      ensureRoom(rowH + 30);

      // Zebra
      if (i % 2 === 0) doc.save().rect(left, doc.y - 2, usableWidth, rowH + 4).fill(theme.color.zebra).restore();

      // Zellen
      let x = left; const baseY = doc.y + rowPad;
      columns.forEach((col, idx) => {
        const txt = col.render ? col.render(row) : (row[col.key] ?? '');
        const color = typeof col.color === 'function' ? col.color(row) : theme.color.text;
        doc.fillColor(color).font(theme.font.regular).fontSize(10)
          .text(String(txt ?? ''), x + 2, baseY, { width: widths[idx] - 4, align: col.align || 'left' });
        x += widths[idx];
      });

      doc.moveTo(left, baseY + (rowH - rowPad)).lineTo(right, baseY + (rowH - rowPad))
        .lineWidth(0.3).strokeColor('#eef2f7').stroke();

      doc.y = baseY + (rowH - rowPad) + 2;
    });

    // Summenzeile
    if (sumRow) {
      ensureRoom(28);
      doc.moveDown(0.2);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.6).strokeColor(theme.color.border).stroke();
      doc.moveDown(0.2);
      let x = left; const baseY = doc.y + rowPad + 2;
      sumRow.forEach((val, idx) => {
        const align = columns[idx]?.align || 'left';
        doc.font(theme.font.bold).fillColor(theme.color.text).fontSize(10)
          .text(String(val ?? ''), x + 2, baseY, { width: widths[idx] - 4, align });
        x += widths[idx];
      });
      doc.font(theme.font.regular);
      doc.y = baseY + 16;
    }

    doc.moveDown(1);
    doc.x = theme.page.margin;
  }

  /* ========= CSV ========= */
  async exportTransactionsCSV(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod } = filters;
    const where = { cancelled: false };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    const transactions = await prisma.transaction.findMany({
      where,
      include: { customer: true, user: { select: { name: true } }, items: { include: { article: true } } },
      orderBy: { createdAt: 'asc' }
    });

    const rows = [];
    transactions.forEach(t => t.items.forEach(item => rows.push({
      Transaktions_ID: t.id,
      Datum: t.createdAt.toLocaleString('de-DE'),
      Kunde: t.customer?.name || 'Bar-Zahlung',
      Artikel: item.article.name,
      Kategorie: item.article.category,
      Menge: item.quantity,
      Einheit: item.article.unit,
      Einzelpreis: item.pricePerUnit,
      Gesamtpreis: item.totalPrice,
      Zahlungsart: t.paymentMethod === 'CASH' ? 'Bar' : 'Kundenkonto',
      Kassierer: t.user.name
    })));

    const fields = ['Transaktions_ID', 'Datum', 'Kunde', 'Artikel', 'Kategorie', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamtpreis', 'Zahlungsart', 'Kassierer'];
    const csv = parse(rows, { fields, delimiter: ';' });
    return { data: csv, filename: `transaktionen_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportInventoryCSV() {
    const articles = await prisma.article.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    const data = articles.map(a => ({
      ID: a.id, Name: a.name, Kategorie: a.category, Preis: a.price, Bestand: a.stock,
      Mindestbestand: a.minStock, Einheit: a.unit, Aktiv: a.active ? 'Ja' : 'Nein',
      'Zählt für Highscore': a.countsForHighscore ? 'Ja' : 'Nein'
    }));
    const fields = ['ID', 'Name', 'Kategorie', 'Preis', 'Bestand', 'Mindestbestand', 'Einheit', 'Aktiv', 'Zählt für Highscore'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `bestand_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  async exportCustomersCSV() {
    const customers = await prisma.customer.findMany({
      include: { _count: { select: { transactions: true } } }, orderBy: { name: 'asc' }
    });

    const data = customers.map(c => ({
      ID: c.id, Name: c.name, Spitzname: c.nickname || '', Guthaben: c.balance,
      'Anzahl Transaktionen': c._count.transactions, 'Erstellt am': c.createdAt.toLocaleString('de-DE')
    }));
    const fields = ['ID', 'Name', 'Spitzname', 'Guthaben', 'Anzahl Transaktionen', 'Erstellt am'];
    const csv = parse(data, { fields, delimiter: ';' });
    return { data: csv, filename: `kunden_${new Date().toISOString().split('T')[0]}.csv`, mimeType: 'text/csv' };
  }

  /* ========= PDF: Tages-/Monats-/EÜR ========= */
  async exportDailySummaryPDF(date = new Date(), startHour = 6) {
    const summary = await this.getDailySummaryData(date, startHour);
    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Tagesabschluss – ${theme.brandName}`, subtitle: `Datum: ${new Date(summary.date).toLocaleDateString('de-DE')} (Ab ${startHour}:00 Uhr)` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        doc.fontSize(11)
          .text(`Gesamtumsatz: ${this._fmtEUR(summary.summary.totalRevenue)}`)
          .text(`Anzahl Transaktionen: ${summary.summary.totalTransactions}`)
          .text(`Bar-Umsatz: ${this._fmtEUR(summary.summary.cashRevenue)} (${summary.summary.cashTransactions} Transaktionen)`)
          .text(`Kundenkonto-Umsatz: ${this._fmtEUR(summary.summary.accountRevenue)} (${summary.summary.accountTransactions} Transaktionen)`)
          .text(`Stornierte Transaktionen: ${summary.summary.cancelledTransactions}`);

        this._section(doc, theme, 'Top 10 Artikel');
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Artikel', width: 300, render: r => r.name },
            { header: 'Menge', width: 80, align: 'right', render: r => String(r.quantity_sold) },
            { header: 'Umsatz', width: 120, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: (summary.topArticles || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Verkäufe erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Umsatzverteilung nach Stunden');
        this._table(doc, theme, {
          columns: [
            { header: 'Stunde', width: 120, render: r => `${r.hour}:00 – ${r.hour}:59` },
            { header: 'Transaktionen', width: 140, align: 'right', render: r => String(r.transactions) },
            { header: 'Umsatz', width: 200, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: summary.hourlyDistribution || [],
          emptyHint: 'Keine Daten vorhanden.',
          headerInfo
        });

        // Fußzeilen jetzt schreiben, dann enden
        doc.end();
        done.then(pdf => resolve({ data: pdf, filename: `tagesabschluss_${summary.date}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  async exportMonthlySummaryPDF(year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    const [transactions, topCustomers, categoryStats] = await Promise.all([
      prisma.transaction.aggregate({
        where: { createdAt: { gte: startDate, lte: endDate }, cancelled: false },
        _sum: { totalAmount: true }, _count: true
      }),
      prisma.$queryRaw`
        SELECT c.name, COUNT(DISTINCT t.id) as transactions, SUM(t."totalAmount") as total_spent
        FROM "Customer" c
        JOIN "Transaction" t ON t."customerId" = c.id
        WHERE t."createdAt" >= ${startDate} AND t."createdAt" <= ${endDate} AND t.cancelled = false
        GROUP BY c.id, c.name
        ORDER BY total_spent DESC
        LIMIT 10
      `,
      prisma.$queryRaw`
        SELECT a.category, SUM(ti.quantity) as items_sold, SUM(ti."totalPrice") as revenue
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${startDate} AND t."createdAt" <= ${endDate} AND t.cancelled = false
        GROUP BY a.category
        ORDER BY revenue DESC
      `
    ]);

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Monatsbericht – ${theme.brandName}`, subtitle: `${this.getMonthName(month)} ${year}` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        const total = transactions._sum.totalAmount || 0;
        const count = transactions._count || 0;
        doc.fontSize(11)
          .text(`Gesamtumsatz: ${this._fmtEUR(total)}`)
          .text(`Anzahl Transaktionen: ${count}`)
          .text(`Durchschnitt pro Transaktion: ${this._fmtEUR(count ? total / count : 0)}`);

        this._section(doc, theme, 'Top 10 Kunden');
        this._table(doc, theme, {
          columns: [
            { header: '#', width: 40, align: 'right', render: r => String(r.__idx + 1) },
            { header: 'Name', width: 260, render: r => r.name },
            { header: 'Käufe', width: 120, align: 'right', render: r => String(r.transactions) },
            { header: 'Umsatz', width: 150, align: 'right', render: r => this._fmtEUR(r.total_spent), color: () => theme.color.success }
          ],
          rows: (topCustomers || []).map((r, i) => ({ ...r, __idx: i })),
          emptyHint: 'Keine Kundendaten vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Umsatz nach Kategorien');
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 320, render: r => r.category },
            { header: 'Artikel', width: 120, align: 'right', render: r => String(r.items_sold) },
            { header: 'Umsatz', width: 160, align: 'right', render: r => this._fmtEUR(r.revenue), color: () => theme.color.success }
          ],
          rows: categoryStats || [],
          emptyHint: 'Keine Kategorien vorhanden.',
          headerInfo
        });

        doc.end();
        done.then(pdf => resolve({
          data: pdf, filename: `monatsbericht_${year}_${String(month).padStart(2, '0')}.pdf`, mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  async exportEURPDF(startDate, endDate) {
    const eur = await accountingService.getProfitLoss(startDate, endDate);
    const start = new Date(startDate);
    const end = new Date(endDate); end.setHours(23, 59, 59, 999);

    const [soldArticles, paidInvoices, expenseDocs] = await Promise.all([
      prisma.$queryRaw`
        SELECT a.name as article, a.category as category, SUM(ti.quantity) as quantity, SUM(ti."totalPrice") as amount
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end}
          AND t.cancelled = false AND t.type = 'SALE'
        GROUP BY a.id, a.name, a.category
        ORDER BY amount DESC
      `,
      prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: { gte: start, lte: end } },
        orderBy: { paidAt: 'asc' },
        select: { invoiceNumber: true, customerName: true, description: true, paidAt: true, totalAmount: true }
      }),
      prisma.purchaseDocument.findMany({
        where: { type: 'RECHNUNG', paid: true, documentDate: { gte: start, lte: end } },
        orderBy: { documentDate: 'asc' },
        select: { documentNumber: true, supplier: true, documentDate: true, totalAmount: true }
      })
    ]);

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();
        const headerInfo = { title: `Einnahmen-Überschuss-Rechnung – ${theme.brandName}`, subtitle: `Zeitraum: ${startDate} – ${endDate}` };
        this._decoratePage(doc, theme, headerInfo);

        this._section(doc, theme, 'Zusammenfassung');
        doc.fontSize(11)
          .text(`Einnahmen gesamt: ${this._fmtEUR(eur.summary.totalIncome)}`, { fill: theme.color.success })
          .text(`Ausgaben gesamt: ${this._fmtEUR(eur.summary.totalExpenses)}`)
          .text(`Gewinn/Verlust: ${this._fmtEUR(eur.summary.profit)}`);

        this._section(doc, theme, 'Einnahmen nach Kategorie');
        this._table(doc, theme, {
          columns: [
            { header: 'Kategorie', width: 360, render: r => r.category },
            { header: 'Betrag', width: 160, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: eur.details.incomeByCategory || [],
          emptyHint: 'Keine Kategorien vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgaben nach Lieferant');
        this._table(doc, theme, {
          columns: [
            { header: 'Lieferant', width: 320, render: r => r.supplier },
            { header: 'Belege', width: 80, align: 'right', render: r => String(r.count) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.danger }
          ],
          rows: eur.details.expensesBySupplier || [],
          emptyHint: 'Keine Ausgaben erfasst.',
          headerInfo
        });

        this._section(doc, theme, 'Verkaufte Artikel');
        const soldSumAmount = (soldArticles || []).reduce((a, r) => a + Number(r.amount || 0), 0);
        const soldSumQty = (soldArticles || []).reduce((a, r) => a + Number(r.quantity || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 260, render: r => r.article },
            { header: 'Kategorie', width: 160, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
            { header: 'Betrag', width: 120, align: 'right', render: r => this._fmtEUR(r.amount), color: () => theme.color.success }
          ],
          rows: soldArticles || [],
          sumRow: ['Summe', '', Number(soldSumQty).toFixed(0), this._fmtEUR(soldSumAmount)],
          emptyHint: 'Keine Verkäufe im Zeitraum.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Ausgangsrechnungen');
        const paidInvSum = (paidInvoices || []).reduce((a, r) => a + Number(r.totalAmount || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Empfänger', width: 220, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 220, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 100, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.success }
          ],
          rows: paidInvoices || [],
          sumRow: ['Summe', '', '', this._fmtEUR(paidInvSum)],
          emptyHint: 'Keine bezahlten Ausgangsrechnungen.',
          headerInfo
        });

        this._section(doc, theme, 'Ausgabenbelege (bezahlt)');
        const expenseSum = (expenseDocs || []).reduce((a, r) => a + Number(r.totalAmount || 0), 0);
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 100, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 220, render: r => r.supplier || '-' },
            { header: 'Belegnr.', width: 140, render: r => r.documentNumber || '-' },
            { header: 'Betrag', width: 100, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: expenseDocs || [],
          sumRow: ['Summe', '', '', this._fmtEUR(expenseSum)],
          emptyHint: 'Keine Ausgabenbelege.',
          headerInfo
        });

        doc.end();
        done.then(pdf => resolve({ data: pdf, filename: `eur_${startDate}_${endDate}.pdf`, mimeType: 'application/pdf' }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= PDF: Jahresabschluss (Deckblatt + Summary) ========= */
  async exportYearEndReportPDF(fiscalYearId) {
    const report = await accountingService.getYearEndReport(fiscalYearId);
    if (!report) throw new Error('Abschlussbericht nicht gefunden');
    const { fiscalYear } = report;

    const preview = await accountingService.getFiscalYearPreview(fiscalYearId);
    const {
      soldArticles = [], paidInvoices = [], expenseDocs = [], unpaidInvoices = [],
      expiredArticles = [], ownerUseArticles = []
    } = preview;

    // Live-Daten für Einheiten holen (falls Snapshot alt ist)
    const allArticles = await prisma.article.findMany();
    const articleMap = new Map(allArticles.map(a => [a.name, a]));

    // Mapping System-Bestand
    // Merge Snapshot mit Live-Daten für purchaseUnit falls im Snapshot fehlend
    const system = Array.isArray(report.inventorySystem) ? report.inventorySystem.map(x => {
      const live = articleMap.get(x.name);
      return {
        name: x.name,
        unit: x.unit || live?.unit,
        systemQty: Number(x.systemStock || 0),
        price: Number(x.price || 0),
        value: Number(x.value || (Number(x.systemStock || 0) * Number(x.price || 0))),
        purchaseUnit: x.purchaseUnit || live?.purchaseUnit,
        unitsPerPurchase: Number(x.unitsPerPurchase || live?.unitsPerPurchase || 0)
      };
    }) : [];

    // DEBUG LOG
    try {
      console.log(`[PDF DEBUG] System inventory items: ${system.length}`);
      if (system.length > 0) console.log('[PDF DEBUG] First item:', system[0]);
    } catch (e) { }

    const physical = Array.isArray(report.inventoryPhysical) ? report.inventoryPhysical.map(x => ({
      name: x.name, unit: x.unit, physicalQty: Number(x.physicalStock || 0)
    })) : [];

    const physMap = new Map(physical.map(x => [x.name, x]));
    // Map Diff Rows with Value Calculation
    const diffRows = system.map(s => {
      const p = physMap.get(s.name);
      const physicalQty = p ? p.physicalQty : s.systemQty;
      const diff = physicalQty - s.systemQty;
      return {
        name: s.name,
        unit: s.unit,
        systemQty: s.systemQty,
        physicalQty,
        diff,
        price: s.price,
        purchaseUnit: s.purchaseUnit,
        unitsPerPurchase: s.unitsPerPurchase,
        // Werte berechnen
        systemValue: s.value,
        physicalValue: physicalQty * s.price,
        diffValue: diff * s.price
      };
    });

    const sum = (arr, sel) => arr.reduce((acc, r) => acc + Number(sel(r) || 0), 0);
    const soldSumAmount = sum(soldArticles, r => r.amount);
    const soldSumQty = sum(soldArticles, r => r.quantity);
    const paidInvSum = sum(paidInvoices, r => r.totalAmount);
    const expenseSum = sum(expenseDocs, r => r.totalAmount);
    const unpaidSum = sum(unpaidInvoices, r => r.totalAmount);
    // Inventory Sums
    const systemQtySum = sum(system, r => r.systemQty);
    const systemValueSum = sum(system, r => r.value);

    // Diff Table Sums
    const physQtySum = sum(diffRows, r => r.physicalQty);
    const diffQtySum = sum(diffRows, r => r.diff);
    // Values
    const physValueSum = sum(diffRows, r => r.physicalValue);
    const diffValueSum = sum(diffRows, r => r.diffValue);

    const banksTotal = sum((report.bankAccountsJson || []), b => b.balance);

    return new Promise((resolve, reject) => {
      try {
        const { doc, done, theme } = this._createDocWithBuffer();

        // DECKBLATT
        doc.fillColor(theme.color.primary).font(theme.font.bold).fontSize(26)
          .text(`Jahresabschluss – ${theme.brandName}`, theme.page.margin, 140, {
            width: doc.page.width - theme.page.margin * 2, align: 'left'
          });

        const sub = `Geschäftsjahr: ${fiscalYear.name} (${new Date(fiscalYear.startDate).toISOString().slice(0, 10)} – ${new Date(fiscalYear.endDate).toISOString().slice(0, 10)})`;
        doc.moveDown(0.5);
        doc.font(theme.font.regular).fontSize(12).fillColor(theme.color.subtext)
          .text(sub, { width: doc.page.width - theme.page.margin * 2 });

        // Executive Summary Panel (roundedRect-Fallback)
        const panelX = theme.page.margin;
        const panelY = 210;
        const panelW = doc.page.width - theme.page.margin * 2;
        const panelH = 170;
        const radius = 8;

        doc.save();
        if (typeof doc.roundedRect === 'function') {
          doc.roundedRect(panelX, panelY, panelW, panelH, radius).fill(theme.color.panelBg);
        } else {
          doc.rect(panelX, panelY, panelW, panelH).fill(theme.color.panelBg);
        }
        doc.restore();

        doc.save().lineWidth(1).strokeColor(theme.color.border);
        if (typeof doc.roundedRect === 'function') {
          doc.roundedRect(panelX, panelY, panelW, panelH, radius).stroke();
        } else {
          doc.rect(panelX, panelY, panelW, panelH).stroke();
        }
        doc.restore();

        doc.font(theme.font.bold).fontSize(14).fillColor(theme.color.text)
          .text('Executive Summary', panelX + 16, panelY + 12);

        const KPI = (label, value, x, y, color) => {
          doc.font(theme.font.regular).fontSize(10).fillColor(theme.color.subtext).text(label, x, y);
          doc.font(theme.font.bold).fontSize(12).fillColor(color || theme.color.text).text(value, x, y + 12);
        };
        const col1x = panelX + 16, col2x = panelX + panelW / 2 + 8, lineH = 20, kpiY = panelY + 40;

        KPI('Einnahmen gesamt', this._fmtEUR(report.incomeTotal), col1x, kpiY, theme.color.success);
        KPI('Ausgaben gesamt', this._fmtEUR(report.expensesTotal), col1x, kpiY + lineH, theme.color.danger);
        KPI('Gewinn/Verlust', this._fmtEUR(report.profit), col1x, kpiY + lineH * 2);

        KPI('Barkasse', this._fmtEUR(report.cashOnHand), col2x, kpiY);
        KPI('Banken gesamt', this._fmtEUR(banksTotal), col2x, kpiY + lineH);
        KPI('Offene Ausgangsrechnungen', this._fmtEUR(unpaidSum), col2x, kpiY + lineH * 2, theme.color.danger);

        // INHALT ab Seite 2
        const headerInfo = {
          title: `Jahresabschluss – ${theme.brandName}`,
          subtitle: `Geschäftsjahr: ${fiscalYear.name} (${new Date(fiscalYear.startDate).toISOString().slice(0, 10)} – ${new Date(fiscalYear.endDate).toISOString().slice(0, 10)})`
        };
        this._addPageDecorated(doc, theme, headerInfo);

        this._section(doc, theme, 'Übersicht & Kennzahlen');
        doc.fontSize(11)
          .fillColor(theme.color.success).text(`Einnahmen gesamt: ${this._fmtEUR(report.incomeTotal)}`)
          .fillColor(theme.color.danger).text(`Ausgaben gesamt: ${this._fmtEUR(report.expensesTotal)}`)
          .fillColor(theme.color.text).text(`Gewinn/Verlust: ${this._fmtEUR(report.profit)}`);

        doc.moveDown(0.5);
        doc.text(`Barkasse: ${this._fmtEUR(report.cashOnHand)}`)
          .text(`Gästeguthaben (Summe): ${this._fmtEUR(report.guestBalance)}`);
        (report.bankAccountsJson || []).forEach(b =>
          doc.text(`Bankkonto ${b.name || ''}${b.iban ? ` (${b.iban})` : ''}: ${this._fmtEUR(b.balance)}`)
        );

        // --- BESTAND & WAREN ---
        this._section(doc, theme, 'Bestand laut System');
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 200, render: r => r.name },
            { header: 'Menge (System)', width: 100, align: 'right', render: r => this._fmtQty(r.systemQty, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Einzelpreis', width: 70, align: 'right', render: r => this._fmtEUR(r.price) },
            { header: 'Warenwert', width: 80, align: 'right', render: r => this._fmtEUR(r.value), color: () => theme.color.text }
          ],
          rows: system || [],
          sumRow: ['Summe', '', '', this._fmtEUR(systemValueSum)],
          emptyHint: 'Keine Bestandsdaten.',
          headerInfo
        });

        this._section(doc, theme, 'Echter Bestand & Differenz');
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 140, render: r => r.name },
            { header: 'System', width: 100, align: 'right', render: r => this._fmtQty(r.systemQty, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Echt', width: 100, align: 'right', render: r => this._fmtQty(r.physicalQty, r.unit, r.purchaseUnit, r.unitsPerPurchase) },
            { header: 'Wert (Echt)', width: 80, align: 'right', render: r => this._fmtEUR(r.physicalValue) },
            { header: 'Diff. Menge', width: 100, align: 'right', render: r => this._fmtQty(r.diff, r.unit, r.purchaseUnit, r.unitsPerPurchase), color: (r) => r.diff < 0 ? theme.color.danger : theme.color.success },
            { header: 'Diff. Wert', width: 80, align: 'right', render: r => this._fmtEUR(r.diffValue), color: (r) => r.diffValue < 0 ? theme.color.danger : theme.color.success }
          ],
          rows: diffRows || [],
          sumRow: ['Summe', '', '', this._fmtEUR(physValueSum), '', this._fmtEUR(diffValueSum)],
          emptyHint: 'Keine Differenzdaten.',
          headerInfo
        });

        this._section(doc, theme, 'Abgelaufene Artikel (Verlust)');
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 340, render: r => r.article },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
          ],
          rows: expiredArticles || [],
          emptyHint: 'Keine abgelaufenen Artikel.',
          headerInfo
        });

        this._section(doc, theme, 'Eigenverbrauch (Sachentnahme)');
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 340, render: r => r.article },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
          ],
          rows: ownerUseArticles || [],
          emptyHint: 'Kein Eigenverbrauch.',
          headerInfo
        });

        // --- FINANZEN DETAILS ---
        this._section(doc, theme, 'Alle Einnahmen (nach Artikel)');
        this._table(doc, theme, {
          columns: [
            { header: 'Artikel', width: 260, render: r => r.article },
            { header: 'Kategorie', width: 180, render: r => r.category || '-' },
            { header: 'Menge', width: 80, align: 'right', render: r => Number(r.quantity || 0).toFixed(0) },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.amount), color: () => this.getTheme().color.success }
          ],
          rows: soldArticles || [],
          sumRow: ['Summe', '', Number(soldSumQty).toFixed(0), this._fmtEUR(soldSumAmount)],
          emptyHint: 'Keine Verkäufe.',
          headerInfo
        });

        this._section(doc, theme, 'Bezahlte Ausgangsrechnungen');
        this._table(doc, theme, {
          columns: [
            { header: 'Empfänger', width: 200, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 220, render: r => r.description || '-' },
            { header: 'Bezahlt am', width: 120, render: r => this._fmtDate(r.paidAt) },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => this.getTheme().color.success }
          ],
          rows: paidInvoices || [],
          sumRow: ['Summe', '', '', this._fmtEUR(paidInvSum)],
          emptyHint: 'Keine bezahlten Ausgangsrechnungen.',
          headerInfo
        });

        // Detail-Liste für Ausgaben (Neue Anforderung)
        this._section(doc, theme, 'Detaillierte Ausgabenliste');
        this._table(doc, theme, {
          columns: [
            { header: 'Datum', width: 80, render: r => this._fmtDate(r.documentDate) },
            { header: 'Lieferant', width: 180, render: r => r.supplier || '-' },
            { header: 'Beleg', width: 100, render: r => r.documentNumber || '-' },
            { header: 'Nachweis', width: 60, align: 'center', render: r => r.nachweisUrl ? 'Ja' : 'Nein' },
            { header: 'Status', width: 60, render: r => r.paid ? 'Bezahlt' : 'Offen' },
            { header: 'Betrag', width: 60, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: expenseDocs || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(expenseSum)],
          emptyHint: 'Keine Ausgaben vorhanden.',
          headerInfo
        });

        this._section(doc, theme, 'Offene Ausgangsrechnungen');
        this._table(doc, theme, {
          columns: [
            { header: 'Empfänger', width: 200, render: r => r.customerName || '-' },
            { header: 'Beschreibung', width: 200, render: r => r.description || '-' },
            { header: 'Erstellt am', width: 80, render: r => this._fmtDate(r.createdAt) },
            { header: 'Fällig am', width: 80, render: r => this._fmtDate(r.dueDate) },
            { header: 'Status', width: 60, render: r => r.status },
            { header: 'Betrag', width: 80, align: 'right', render: r => this._fmtEUR(r.totalAmount), color: () => theme.color.danger }
          ],
          rows: unpaidInvoices || [],
          sumRow: ['Summe', '', '', '', '', this._fmtEUR(unpaidSum)],
          emptyHint: 'Keine offenen Rechnungen.',
          headerInfo
        });

        // Fußzeilen für alle Seiten
        doc.end();
        done.then(pdf => resolve({
          data: pdf, filename: `jahresabschluss_${fiscalYear.name.replace(/\s+/g, '_')}.pdf`, mimeType: 'application/pdf'
        }));
      } catch (e) { reject(e); }
    });
  }

  /* ========= HELPERS ========= */
  async getDailySummaryData(date, startHour) {
    const transactionService = require('./transactionService');
    return await transactionService.getDailySummary(date, startHour);
  }

  getMonthName(month) {
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return months[month - 1];
  }
}

module.exports = new ExportService();
