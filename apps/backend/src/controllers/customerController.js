const customerService = require('../services/customerService');
const prisma = require('../utils/prisma');

class CustomerController {
  // Liste alle Kunden
  async listCustomers(req, res) {
    try {
      const { search } = req.query;
      const customers = await customerService.listCustomers(search);
      
      res.json({
        customers,
        count: customers.length
      });
    } catch (error) {
      console.error('List customers error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Kunden' });
    }
  }
  
  // Einzelnen Kunden abrufen
  async getCustomer(req, res) {
    try {
      const { id } = req.params;
      const customer = await customerService.findById(id);
      
      if (!customer) {
        return res.status(404).json({ error: 'Kunde nicht gefunden' });
      }
      
      res.json({ customer });
    } catch (error) {
      console.error('Get customer error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Kunden' });
    }
  }
  
  // Neuen Kunden erstellen
  async createCustomer(req, res) {
    try {
      const customer = await customerService.createCustomer(req.body);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_CUSTOMER',
          entityType: 'Customer',
          entityId: customer.id,
          changes: req.body
        }
      });
      
      res.status(201).json({
        message: 'Kunde erfolgreich erstellt',
        customer
      });
    } catch (error) {
      console.error('Create customer error:', error);
      
      if (error.message.includes('existiert bereits')) {
        return res.status(400).json({ error: error.message });
      }
      
      res.status(500).json({ error: 'Fehler beim Erstellen des Kunden' });
    }
  }
  
  // Kunden aktualisieren
  async updateCustomer(req, res) {
    try {
      const { id } = req.params;
      
      const customer = await customerService.updateCustomer(id, req.body);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_CUSTOMER',
          entityType: 'Customer',
          entityId: id,
          changes: req.body
        }
      });
      
      res.json({
        message: 'Kunde erfolgreich aktualisiert',
        customer
      });
    } catch (error) {
      console.error('Update customer error:', error);
      
      if (error.message.includes('existiert bereits')) {
        return res.status(400).json({ error: error.message });
      }
      
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Kunden' });
    }
  }
  
  // Guthaben aufladen
  async topUpAccount(req, res) {
    try {
      const { id } = req.params;
      const { amount, method, reference } = req.body;
      
      const result = await customerService.topUpAccount(id, amount, method, reference);
      
      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CUSTOMER_TOPUP',
          entityType: 'Customer',
          entityId: id,
          changes: {
            amount,
            method,
            reference,
            newBalance: result.customer.balance
          }
        }
      });
      
      res.json({
        message: 'Guthaben erfolgreich aufgeladen',
        topUp: result.topUp,
        customer: result.customer
      });
    } catch (error) {
      console.error('Top up account error:', error);
      res.status(500).json({ error: error.message || 'Fehler beim Aufladen des Guthabens' });
    }
  }
  
  // Kunden-Statistiken
  async getCustomerStats(req, res) {
    try {
      const { id } = req.params;
      const stats = await customerService.getCustomerStats(id);
      
      if (!stats.customer) {
        return res.status(404).json({ error: 'Kunde nicht gefunden' });
      }
      
      res.json(stats);
    } catch (error) {
      console.error('Get customer stats error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Statistiken' });
    }
  }
  
  // Kontoauszug
  async getAccountStatement(req, res) {
    try {
      const { id } = req.params;
      const { startDate, endDate } = req.query;
      
      // Default: Letzter Monat
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const statement = await customerService.getAccountStatement(id, start, end);
      
      res.json(statement);
    } catch (error) {
      console.error('Get account statement error:', error);
      res.status(500).json({ error: 'Fehler beim Erstellen des Kontoauszugs' });
    }
  }
  
  // Kunden mit niedrigem Guthaben
  async getCustomersWithLowBalance(req, res) {
    try {
      const threshold = parseFloat(req.query.threshold) || 5;
      const customers = await customerService.getCustomersWithLowBalance(threshold);
      
      res.json({
        customers,
        count: customers.length,
        threshold
      });
    } catch (error) {
      console.error('Get low balance customers error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Kunden mit niedrigem Guthaben' });
    }
  }
}

module.exports = new CustomerController();
