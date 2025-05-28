const { parse } = require('json2csv');
const PDFDocument = require('pdfkit');
const prisma = require('../utils/prisma');
const fs = require('fs').promises;
const path = require('path');

class ExportService {
  constructor() {
    // Erstelle Export-Verzeichnis falls nicht vorhanden
    this.exportDir = path.join(process.cwd(), 'exports');
    this.ensureExportDir();
  }
  
  async ensureExportDir() {
    try {
      await fs.mkdir(this.exportDir, { recursive: true });
    } catch (error) {
      console.error('Error creating export directory:', error);
    }
  }
  
  // Export Transaktionen als CSV
  async exportTransactionsCSV(filters = {}) {
    const { startDate, endDate, customerId, paymentMethod } = filters;
    
    // Hole Transaktionen
    const where = {
      cancelled: false
    };
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    
    if (customerId) where.customerId = customerId;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    
    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        customer: true,
        user: {
          select: {
            name: true
          }
        },
        items: {
          include: {
            article: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    
    // Formatiere Daten für CSV
    const flatData = [];
    
    transactions.forEach(transaction => {
      transaction.items.forEach(item => {
        flatData.push({
          Transaktions_ID: transaction.id,
          Datum: transaction.createdAt.toLocaleString('de-DE'),
          Kunde: transaction.customer?.name || 'Bar-Zahlung',
          Artikel: item.article.name,
          Kategorie: item.article.category,
          Menge: item.quantity,
          Einheit: item.article.unit,
          Einzelpreis: item.pricePerUnit,
          Gesamtpreis: item.totalPrice,
          Zahlungsart: transaction.paymentMethod === 'CASH' ? 'Bar' : 'Kundenkonto',
          Kassierer: transaction.user.name
        });
      });
    });
    
    // Erstelle CSV
    const fields = [
      'Transaktions_ID',
      'Datum',
      'Kunde',
      'Artikel',
      'Kategorie',
      'Menge',
      'Einheit',
      'Einzelpreis',
      'Gesamtpreis',
      'Zahlungsart',
      'Kassierer'
    ];
    
    const csv = parse(flatData, { fields, delimiter: ';' });
    
    return {
      data: csv,
      filename: `transaktionen_${new Date().toISOString().split('T')[0]}.csv`,
      mimeType: 'text/csv'
    };
  }
  
  // Export Artikel-Bestand als CSV
  async exportInventoryCSV() {
    const articles = await prisma.article.findMany({
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ]
    });
    
    const data = articles.map(article => ({
      ID: article.id,
      Name: article.name,
      Kategorie: article.category,
      Preis: article.price,
      Bestand: article.stock,
      Mindestbestand: article.minStock,
      Einheit: article.unit,
      Aktiv: article.active ? 'Ja' : 'Nein',
      'Zählt für Highscore': article.countsForHighscore ? 'Ja' : 'Nein'
    }));
    
    const fields = [
      'ID',
      'Name',
      'Kategorie',
      'Preis',
      'Bestand',
      'Mindestbestand',
      'Einheit',
      'Aktiv',
      'Zählt für Highscore'
    ];
    
    const csv = parse(data, { fields, delimiter: ';' });
    
    return {
      data: csv,
      filename: `bestand_${new Date().toISOString().split('T')[0]}.csv`,
      mimeType: 'text/csv'
    };
  }
  
  // Export Kunden mit Guthaben als CSV
  async exportCustomersCSV() {
    const customers = await prisma.customer.findMany({
      include: {
        _count: {
          select: { transactions: true }
        }
      },
      orderBy: { name: 'asc' }
    });
    
    const data = customers.map(customer => ({
      ID: customer.id,
      Name: customer.name,
      Spitzname: customer.nickname || '',
      Guthaben: customer.balance,
      'Anzahl Transaktionen': customer._count.transactions,
      'Erstellt am': customer.createdAt.toLocaleString('de-DE')
    }));
    
    const fields = [
      'ID',
      'Name',
      'Spitzname',
      'Guthaben',
      'Anzahl Transaktionen',
      'Erstellt am'
    ];
    
    const csv = parse(data, { fields, delimiter: ';' });
    
    return {
      data: csv,
      filename: `kunden_${new Date().toISOString().split('T')[0]}.csv`,
      mimeType: 'text/csv'
    };
  }
  
  // Export Tagesabschluss als PDF
  async exportDailySummaryPDF(date = new Date()) {
    const summary = await this.getDailySummaryData(date);
    
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({
            data: pdfBuffer,
            filename: `tagesabschluss_${summary.date}.pdf`,
            mimeType: 'application/pdf'
          });
        });
        
        // Header
        doc.fontSize(20).text('Clubtouch3 Tagesabschluss', { align: 'center' });
        doc.fontSize(14).text(`Datum: ${new Date(summary.date).toLocaleDateString('de-DE')}`, { align: 'center' });
        doc.moveDown(2);
        
        // Zusammenfassung
        doc.fontSize(16).text('Zusammenfassung', { underline: true });
        doc.fontSize(12);
        doc.text(`Gesamtumsatz: €${summary.summary.totalRevenue.toFixed(2)}`);
        doc.text(`Anzahl Transaktionen: ${summary.summary.totalTransactions}`);
        doc.text(`Bar-Umsatz: €${summary.summary.cashRevenue.toFixed(2)} (${summary.summary.cashTransactions} Transaktionen)`);
        doc.text(`Kundenkonto-Umsatz: €${summary.summary.accountRevenue.toFixed(2)} (${summary.summary.accountTransactions} Transaktionen)`);
        doc.text(`Stornierte Transaktionen: ${summary.summary.cancelledTransactions}`);
        doc.moveDown();
        
        // Top Artikel
        doc.fontSize(16).text('Top 10 Artikel', { underline: true });
        doc.fontSize(10);
        
        summary.topArticles.forEach((article, index) => {
          doc.text(`${index + 1}. ${article.name} - ${article.quantity_sold} verkauft, €${Number(article.revenue).toFixed(2)} Umsatz`);
        });
        
        doc.moveDown();
        
        // Umsatz nach Stunden
        doc.fontSize(16).text('Umsatzverteilung nach Stunden', { underline: true });
        doc.fontSize(10);
        
        summary.hourlyDistribution.forEach(hour => {
          const hourStr = `${hour.hour}:00 - ${hour.hour}:59`;
          doc.text(`${hourStr}: ${hour.transactions} Transaktionen, €${Number(hour.revenue).toFixed(2)}`);
        });
        
        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text(`Erstellt am: ${new Date().toLocaleString('de-DE')}`, { align: 'center' });
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // Export Monatsübersicht als PDF
  async exportMonthlySummaryPDF(year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const [transactions, topCustomers, categoryStats] = await Promise.all([
      // Transaktionsdaten
      prisma.transaction.aggregate({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          },
          cancelled: false
        },
        _sum: {
          totalAmount: true
        },
        _count: true
      }),
      
      // Top Kunden
      prisma.$queryRaw`
        SELECT 
          c.name,
          COUNT(DISTINCT t.id) as transactions,
          SUM(t."totalAmount") as total_spent
        FROM "Customer" c
        JOIN "Transaction" t ON t."customerId" = c.id
        WHERE t."createdAt" >= ${startDate}
          AND t."createdAt" <= ${endDate}
          AND t.cancelled = false
        GROUP BY c.id, c.name
        ORDER BY total_spent DESC
        LIMIT 10
      `,
      
      // Umsatz nach Kategorien
      prisma.$queryRaw`
        SELECT 
          a.category,
          SUM(ti.quantity) as items_sold,
          SUM(ti."totalPrice") as revenue
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        JOIN "Article" a ON ti."articleId" = a.id
        WHERE t."createdAt" >= ${startDate}
          AND t."createdAt" <= ${endDate}
          AND t.cancelled = false
        GROUP BY a.category
        ORDER BY revenue DESC
      `
    ]);
    
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({
            data: pdfBuffer,
            filename: `monatsbericht_${year}_${String(month).padStart(2, '0')}.pdf`,
            mimeType: 'application/pdf'
          });
        });
        
        // Header
        doc.fontSize(20).text('Clubtouch3 Monatsbericht', { align: 'center' });
        doc.fontSize(14).text(`${this.getMonthName(month)} ${year}`, { align: 'center' });
        doc.moveDown(2);
        
        // Zusammenfassung
        doc.fontSize(16).text('Zusammenfassung', { underline: true });
        doc.fontSize(12);
        doc.text(`Gesamtumsatz: €${(transactions._sum.totalAmount || 0).toFixed(2)}`);
        doc.text(`Anzahl Transaktionen: ${transactions._count}`);
        doc.text(`Durchschnitt pro Transaktion: €${(transactions._sum.totalAmount / transactions._count || 0).toFixed(2)}`);
        doc.moveDown();
        
        // Top Kunden
        doc.fontSize(16).text('Top 10 Kunden', { underline: true });
        doc.fontSize(10);
        
        topCustomers.forEach((customer, index) => {
          doc.text(`${index + 1}. ${customer.name} - ${customer.transactions} Käufe, €${Number(customer.total_spent).toFixed(2)}`);
        });
        
        doc.moveDown();
        
        // Kategorien
        doc.fontSize(16).text('Umsatz nach Kategorien', { underline: true });
        doc.fontSize(10);
        
        categoryStats.forEach(category => {
          doc.text(`${category.category}: ${category.items_sold} Artikel, €${Number(category.revenue).toFixed(2)}`);
        });
        
        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text(`Erstellt am: ${new Date().toLocaleString('de-DE')}`, { align: 'center' });
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // Export Kunde Kontoauszug als PDF
  async exportCustomerStatementPDF(customerId, startDate, endDate) {
    const customerService = require('./customerService');
    const statement = await customerService.getAccountStatement(customerId, startDate, endDate);
    
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({
            data: pdfBuffer,
            filename: `kontoauszug_${statement.customer.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
            mimeType: 'application/pdf'
          });
        });
        
        // Header
        doc.fontSize(20).text('Kontoauszug', { align: 'center' });
        doc.moveDown();
        
        // Kundendaten
        doc.fontSize(12);
        doc.text(`Kunde: ${statement.customer.name}`);
        if (statement.customer.nickname) {
          doc.text(`Spitzname: ${statement.customer.nickname}`);
        }
        doc.text(`Zeitraum: ${new Date(startDate).toLocaleDateString('de-DE')} - ${new Date(endDate).toLocaleDateString('de-DE')}`);
        doc.text(`Aktuelles Guthaben: €${statement.customer.currentBalance.toFixed(2)}`);
        doc.moveDown();
        
        // Bewegungen
        doc.fontSize(14).text('Kontobewegungen', { underline: true });
        doc.fontSize(10);
        
        // Tabellenkopf
        const tableTop = doc.y;
        doc.text('Datum', 50, tableTop);
        doc.text('Beschreibung', 150, tableTop);
        doc.text('Betrag', 350, tableTop);
        doc.text('Saldo', 450, tableTop);
        doc.moveDown();
        
        // Bewegungen
        statement.movements.forEach(movement => {
          const y = doc.y;
          doc.text(new Date(movement.date).toLocaleDateString('de-DE'), 50, y);
          doc.text(movement.description, 150, y, { width: 180 });
          
          const amountColor = movement.amount >= 0 ? 'green' : 'red';
          doc.fillColor(amountColor)
            .text(`€${movement.amount.toFixed(2)}`, 350, y)
            .fillColor('black');
          
          doc.text(`€${movement.balance.toFixed(2)}`, 450, y);
          doc.moveDown();
        });
        
        // Zusammenfassung
        doc.moveDown();
        doc.fontSize(12).text('Zusammenfassung', { underline: true });
        doc.fontSize(10);
        doc.text(`Aufladungen: €${statement.summary.totalTopUps.toFixed(2)}`);
        doc.text(`Ausgaben: €${statement.summary.totalSpent.toFixed(2)}`);
        doc.text(`Anzahl Transaktionen: ${statement.summary.transactionCount}`);
        
        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text(`Erstellt am: ${new Date().toLocaleString('de-DE')}`, { align: 'center' });
        
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // Hilfsfunktionen
  async getDailySummaryData(date) {
    const transactionService = require('./transactionService');
    return await transactionService.getDailySummary(date);
  }  
  
  getMonthName(month) {
    const months = [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];
    return months[month - 1];
  }
}

module.exports = new ExportService();
