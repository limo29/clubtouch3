const customerService = require('../services/customerService');
const prisma = require('../utils/prisma');
const { sendError } = require('../utils/httpError');
const closedPeriod = require('../utils/closedPeriod');

// Kontaktfelder und die Rollen, die sie sehen und ändern dürfen
const CONTACT_FIELDS = ['company', 'street', 'zip', 'city', 'phone', 'email'];
const CONTACT_ROLES = ['ADMIN', 'ACCOUNTANT', 'CASHIER'];

/**
 * Entfernt Kontaktdaten aus einem Kundenobjekt, wenn die Rolle kein Leserecht dafür hat.
 * Socket und /api/public bekommen sie unabhängig davon nie (CUSTOMER_BASIC_SELECT).
 */
function stripContact(customer, role) {
  if (!customer) return customer;
  if (CONTACT_ROLES.includes(role)) return customer;
  const stripped = { ...customer };
  for (const f of CONTACT_FIELDS) {
    delete stripped[f];
  }
  return stripped;
}

class CustomerController {
  // Liste alle Kunden
  async listCustomers(req, res) {
    try {
      const { search, groupId } = req.query;
      const customers = await customerService.listCustomers(search, groupId || null);
      const role = req.user?.role;

      res.json({
        customers: customers.map((c) => stripContact(c, role)),
        count: customers.length,
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

      res.json({ customer: stripContact(customer, req.user?.role) });
    } catch (error) {
      console.error('Get customer error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Kunden' });
    }
  }

  // Neuen Kunden erstellen
  async createCustomer(req, res) {
    try {
      // Rollen ohne Kontaktrecht dürfen Kontaktdaten nicht setzen – diese Felder werden ignoriert
      const role = req.user?.role;
      const data = { ...req.body };
      if (!CONTACT_ROLES.includes(role)) {
        for (const f of CONTACT_FIELDS) delete data[f];
      }
      const customer = await customerService.createCustomer(data);

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_CUSTOMER',
          entityType: 'Customer',
          entityId: customer.id,
          changes: req.body,
        },
      });

      res.status(201).json({
        message: 'Kunde erfolgreich erstellt',
        customer: stripContact(customer, role),
      });
    } catch (error) {
      sendError(res, error, 'Fehler beim Erstellen des Kunden', 'Create customer error:');
    }
  }

  // Kunden aktualisieren
  async updateCustomer(req, res) {
    try {
      const { id } = req.params;
      // Rollen ohne Kontaktrecht dürfen Kontaktdaten nicht setzen – diese Felder werden ignoriert
      const role = req.user?.role;
      const data = { ...req.body };
      if (!CONTACT_ROLES.includes(role)) {
        for (const f of CONTACT_FIELDS) delete data[f];
      }

      const customer = await customerService.updateCustomer(id, data);

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_CUSTOMER',
          entityType: 'Customer',
          entityId: id,
          changes: req.body,
        },
      });

      res.json({
        message: 'Kunde erfolgreich aktualisiert',
        customer: stripContact(customer, role),
      });
    } catch (error) {
      sendError(res, error, 'Fehler beim Aktualisieren des Kunden', 'Update customer error:');
    }
  }

  // Guthaben aufladen (mit clientId idempotent: Wiederholung → 200 mit der Original-Aufladung und duplicate: true)
  async topUpAccount(req, res) {
    try {
      const { id } = req.params;
      const { amount, method, reference, clientId, clientCreatedAt } = req.body;

      const result = await customerService.topUpAccount(id, amount, method, reference, { clientId, clientCreatedAt, userId: req.user.id });

      if (result.duplicate) {
        return res.json({
          message: 'Aufladung wurde bereits gebucht',
          topUp: result.topUp,
          customer: stripContact(result.customer, req.user?.role),
          duplicate: true,
        });
      }

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
            clientId: result.topUp.clientId || undefined,
            newBalance: result.customer.balance,
          },
        },
      });

      res.json({
        message: 'Guthaben erfolgreich aufgeladen',
        topUp: result.topUp,
        customer: stripContact(result.customer, req.user?.role),
      });
    } catch (error) {
      sendError(res, error, 'Fehler beim Aufladen des Guthabens', 'Top up account error:');
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

      res.json({ ...stats, customer: stripContact(stats.customer, req.user?.role) });
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

      // Default: letzte 30 Tage bis jetzt. "Bis"-Tag inklusive, 'YYYY-MM-DD' lokal.
      const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');
      const end = endDate ? endOfLocalDay(endDate) : new Date();
      const start = startDate
        ? parseLocalDate(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Ungültiger Zeitraum' });
      }

      const statement = await customerService.getAccountStatement(id, start, end);

      res.json(statement);
    } catch (error) {
      sendError(res, error, 'Fehler beim Erstellen des Kontoauszugs', 'Get account statement error:');
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
        threshold,
      });
    } catch (error) {
      console.error('Get low balance customers error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Kunden mit niedrigem Guthaben' });
    }
  }

  // Historie abrufen
  async getHistory(req, res) {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const history = await customerService.getHistory(id, limit);
      res.json(history);
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Historie' });
    }
  }

  // Aufladung stornieren
  async reverseTopUp(req, res) {
    try {
      const { id, topUpId } = req.params;
      const reversal = await customerService.reverseTopUp(topUpId, req.user.id, id, { confirmClosed: closedPeriod.isConfirmed(req) });

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'REVERSE_TOPUP',
          entityType: 'AccountTopUp',
          entityId: topUpId,
          changes: { reversalId: reversal.id },
        },
      });

      res.json({ message: 'Aufladung erfolgreich storniert', reversal });
    } catch (error) {
      sendError(res, error, 'Fehler beim Stornieren der Aufladung', 'Reverse topup error:');
    }
  }
}

module.exports = new CustomerController();
