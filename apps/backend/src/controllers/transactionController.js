const transactionService = require('../services/transactionService');
const prisma = require('../utils/prisma');
const { sendError } = require('../utils/httpError');
const closedPeriod = require('../utils/closedPeriod');

class TransactionController {
  // Erstelle Verkauf (mit clientId idempotent: Wiederholung → 200 mit dem Original und duplicate: true)
  async createSale(req, res) {
    try {
      const { transaction, warnings = [], duplicate } = await transactionService.createSale(req.body, req.user.id);

      if (duplicate) {
        return res.status(200).json({
          message: 'Verkauf wurde bereits gebucht',
          transaction,
          warnings: [],
          duplicate: true
        });
      }

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
            itemCount: transaction.items.length,
            clientId: transaction.clientId || undefined,
            warnings: warnings.length ? warnings : undefined
          }
        }
      });

      res.status(201).json({
        message: 'Verkauf erfolgreich abgeschlossen',
        transaction,
        warnings
      });
    } catch (error) {
      sendError(res, error, 'Fehler beim Verkauf', 'Create sale error:');
    }
  }

  // Storniere Transaktion
  async cancelTransaction(req, res) {
    try {
      const { id } = req.params;
      const result = await transactionService.cancelTransaction(id, req.user.id, { confirmClosed: closedPeriod.isConfirmed(req) });

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
      sendError(res, error, 'Fehler beim Stornieren der Transaktion', 'Cancel transaction error:');
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
      // Optional: Kontoaufladungen im selben Zeitraum (getrennt, sie sind kein Umsatz)
      const topUps = req.query.includeTopUps === 'true'
        ? await transactionService.listTopUps({ ...filters, includeMigration: req.query.includeMigration === 'true' })
        : undefined;

      res.json({
        transactions,
        count: transactions.length,
        ...(topUps ? { topUps } : {}),
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
  async getDailySummary(req, res) {
    try {
      // Datums-String roh durchreichen: businessDayWindow behandelt "YYYY-MM-DD" als diesen Geschäftstag (kein UTC-Versatz)
      const date = req.query.date || new Date();
      const summary = await transactionService.getDailySummary(date);
      res.json(summary);
    } catch (error) {
      console.error('Get daily summary error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen des Tagesabschlusses' });
    }
  }
}

module.exports = new TransactionController();
