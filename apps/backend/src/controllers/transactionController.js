const transactionService = require('../services/transactionService');
const prisma = require('../utils/prisma');

class TransactionController {
  // Erstelle Verkauf
  async createSale(req, res) {
    try {
      const transaction = await transactionService.createSale(req.body, req.user.id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_SALE',
          entityType: 'Transaction',
          entityId: transaction.id,
          changes: {
            totalAmount: transaction.totalAmount,
            paymentMethod: transaction.paymentMethod,
            itemCount: transaction.items.length
          }
        }
      });
      
      res.status(201).json({
        message: 'Verkauf erfolgreich abgeschlossen',
        transaction
      });
    } catch (error) {
      console.error('Create sale error:', error);
      
      // Spezifische Fehlermeldungen
      if (error.message.includes('Nicht genügend')) {
        return res.status(400).json({ error: error.message });
      }
      
      res.status(500).json({ error: error.message || 'Fehler beim Verkauf' });
    }
  }
  
  // Storniere Transaktion
  async cancelTransaction(req, res) {
    try {
      const { id } = req.params;
      const result = await transactionService.cancelTransaction(id, req.user.id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CANCEL_TRANSACTION',
          entityType: 'Transaction',
          entityId: id,
          changes: {
            originalAmount: result.originalTransaction.totalAmount,
            cancelTransactionId: result.cancelTransaction.id
          }
        }
      });
      
      res.json({
        message: 'Transaktion erfolgreich storniert',
        originalTransaction: result.originalTransaction,
        cancelTransaction: result.cancelTransaction
      });
    } catch (error) {
      console.error('Cancel transaction error:', error);
      
      if (error.message.includes('nicht gefunden') || error.message.includes('bereits storniert')) {
        return res.status(400).json({ error: error.message });
      }
      
      res.status(500).json({ error: 'Fehler beim Stornieren der Transaktion' });
    }
  }
  
  // Liste Transaktionen
  async listTransactions(req, res) {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        customerId: req.query.customerId,
        paymentMethod: req.query.paymentMethod,
        includeItems: req.query.includeItems === 'true'
      };
      
      const transactions = await transactionService.listTransactions(filters);
      
      res.json({
        transactions,
        count: transactions.length
      });
    } catch (error) {
      console.error('List transactions error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Transaktionen' });
    }
  }
  
  // Einzelne Transaktion abrufen
  async getTransaction(req, res) {
    try {
      const { id } = req.params;
      const transaction = await transactionService.getTransaction(id);
      
      if (!transaction) {
        return res.status(404).json({ error: 'Transaktion nicht gefunden' });
      }
      
      res.json({ transaction });
    } catch (error) {
      console.error('Get transaction error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Transaktion' });
    }
  }
  
  // Tagesabschluss
// In deinem Controller, z.B. getDailySummary:

async getDailySummary(req, res) {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const summary = await transactionService.getDailySummary(date);

    // Falls noch irgendwo BigInt drin ist (z.B. in topArticles oder hourlyDistribution),
    // kannst du auch dort mit map() und safeNumber konvertieren,
    // oder du serialisierst mit einem custom replacer:
    
    const safeStringify = (obj) => JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );

    res.setHeader('Content-Type', 'application/json');
    res.send(safeStringify(summary));
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Tagesabschlusses' });
  }
}

  
  // Quick Sale - Vereinfachter Verkauf für häufige Artikel
  async quickSale(req, res) {
    try {
      const { articleId, quantity = 1, paymentMethod = 'CASH' } = req.body;
      
      // Erstelle Sale mit einem Artikel
      const saleData = {
        paymentMethod,
        items: [{
          articleId,
          quantity
        }]
      };
      
      const transaction = await transactionService.createSale(saleData, req.user.id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'QUICK_SALE',
          entityType: 'Transaction',
          entityId: transaction.id,
          changes: {
            articleId,
            quantity,
            totalAmount: transaction.totalAmount
          }
        }
      });
      
      res.status(201).json({
        message: 'Schnellverkauf erfolgreich',
        transaction
      });
    } catch (error) {
      console.error('Quick sale error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Schnellverkauf' });
    }
  }
}

module.exports = new TransactionController();
