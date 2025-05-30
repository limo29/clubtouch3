const purchaseService = require('../services/purchaseService');
const fileUploadService = require('../services/fileUploadService');
const prisma = require('../utils/prisma');

class PurchaseController {
  // Liste Einkäufe
  async listPurchases(req, res) {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        paid: req.query.paid,
        search: req.query.search
      };
      
      const purchases = await purchaseService.listPurchases(filters);
      
      res.json({
        purchases,
        count: purchases.length
      });
    } catch (error) {
      console.error('List purchases error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Einkäufe' });
    }
  }

  // Einzelner Einkauf
  async getPurchase(req, res) {
    try {
      const { id } = req.params;
      const purchase = await purchaseService.getPurchase(id);
      
      if (!purchase) {
        return res.status(404).json({ error: 'Einkauf nicht gefunden' });
      }
      
      res.json({ purchase });
    } catch (error) {
      console.error('Get purchase error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Einkaufs' });
    }
  }

  // Erstelle Einkauf
  async createPurchase(req, res) {
    try {
      const purchaseData = req.body;
      
      // Wenn Datei hochgeladen wurde
      if (req.file) {
        purchaseData.invoiceImage = `/uploads/invoices/${req.file.filename}`;
      }
      
      const purchase = await purchaseService.createPurchase(purchaseData, req.user.id);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_PURCHASE',
          entityType: 'Purchase',
          entityId: purchase.id,
          changes: {
            supplier: purchase.supplier,
            amount: purchase.totalAmount
          }
        }
      });
      
      res.status(201).json({
        message: 'Einkauf erfolgreich erstellt',
        purchase
      });
    } catch (error) {
      console.error('Create purchase error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen des Einkaufs' });
    }
  }

  // Markiere als bezahlt
  async markAsPaid(req, res) {
    try {
      const { id } = req.params;
      const { paymentMethod } = req.body;
      
      const purchase = await purchaseService.markAsPaid(id, paymentMethod, req.user.id);
      
      res.json({
        message: 'Einkauf als bezahlt markiert',
        purchase
      });
    } catch (error) {
      console.error('Mark as paid error:', error);
      res.status(500).json({ error: 'Fehler beim Markieren als bezahlt' });
    }
  }

  // EÜR berechnen
  async calculateProfitLoss(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Start- und Enddatum erforderlich' });
      }
      
      const profitLoss = await purchaseService.calculateProfitLoss(
        new Date(startDate),
        new Date(endDate)
      );
      
      res.json(profitLoss);
    } catch (error) {
      console.error('Calculate profit/loss error:', error);
      res.status(500).json({ error: 'Fehler bei der EÜR-Berechnung' });
    }
  }
  async getSuppliers(req, res) {
  try {
    const suppliers = await supplierService.getUniqueSuppliers();
    res.json({ suppliers });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Lieferanten' });
  }
}

}

module.exports = new PurchaseController();
 

