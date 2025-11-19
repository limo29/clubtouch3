const purchaseDocumentService = require('../services/purchaseDocumentService');
const prisma = require('../utils/prisma');

class PurchaseDocumentController {

  // POST /
  async createDocument(req, res) {
    try {
      const data = req.body;

      // Datei-Upload verarbeiten
      let nachweisUrl = null;
      if (req.file) {
        // req.file.path ist der volle Pfad, wir wollen den relativen
        // z.B. /uploads/nachweise/xyz.pdf
        nachweisUrl = req.file.path.replace(process.cwd(), '');
        // Ggf. Backslashes ersetzen auf Windows
        nachweisUrl = nachweisUrl.replace(/\\/g, '/');
      }

      // 'items' wird als JSON-String übermittelt, wenn multipart/form-data verwendet wird
      if (data.items) {
        try {
          data.items = JSON.parse(data.items);
        } catch (e) {
          console.error("Konnte 'items' nicht parsen:", data.items);
          return res.status(400).json({ error: "Ungültiges 'items' Format." });
        }
      }

      // 'lieferscheinIds' wird als JSON-String übermittelt
      if (data.lieferscheinIds) {
        try {
          data.lieferscheinIds = JSON.parse(data.lieferscheinIds);
        } catch (e) {
          console.error("Konnte 'lieferscheinIds' nicht parsen:", data.lieferscheinIds);
          // Wir ignorieren den Fehler hier und machen ohne Lieferscheine weiter, oder werfen Fehler?
          // Besser Fehler, damit der User merkt, dass was nicht stimmt.
          return res.status(400).json({ error: "Ungültiges 'lieferscheinIds' Format." });
        }
      }

      // Datentypen konvertieren (aus FormData sind alles Strings)
      data.totalAmount = data.totalAmount ? parseFloat(data.totalAmount) : null;
      data.paid = data.paid === 'true';

      const document = await purchaseDocumentService.createDocument(
        data,
        req.user.id,
        nachweisUrl
      );

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: `CREATE_${data.type}`,
          entityType: 'PurchaseDocument',
          entityId: document.id,
          changes: {
            documentNumber: document.documentNumber,
            supplier: document.supplier,
            amount: document.totalAmount
          }
        }
      });

      res.status(201).json(document);
    } catch (error) {
      console.error('Create document error:', error);
      // Prisma-Transaktionsfehler abfangen
      if (error.message.includes('Artikel mit ID')) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: 'Fehler beim Erstellen des Belegs' });
    }
  }

  // GET /
  async listDocuments(req, res) {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        paid: req.query.paid,
        search: req.query.search
      };

      const documents = await purchaseDocumentService.listDocuments(filters);

      res.json({
        documents,
        count: documents.length
      });
    } catch (error) {
      console.error('List documents error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Belege' });
    }
  }

  // GET /:id
  async getDocumentById(req, res) {
    try {
      const { id } = req.params;
      const document = await purchaseDocumentService.getDocumentById(id);

      if (!document) {
        return res.status(404).json({ error: 'Beleg nicht gefunden' });
      }

      res.json(document);
    } catch (error) {
      console.error('Get document error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen des Belegs' });
    }
  }
  // GET /suppliers
  async getSuppliers(req, res) {
    try {
      const suppliers = await purchaseDocumentService.getUniqueSuppliers();
      res.json({ suppliers });
    } catch (error) {
      console.error('Get suppliers error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Lieferanten' });
    }
  }
  // GET /unassigned?supplier=...
  async getUnassigned(req, res) {
    try {
      const { supplier } = req.query;
      if (!supplier) {
        return res.status(400).json({ error: 'Ein Lieferant (supplier) ist erforderlich.' });
      }

      const documents = await purchaseDocumentService.getUnassignedLieferscheine(supplier);
      res.json({ documents });
    } catch (error) {
      console.error('Get unassigned error:', error);
      res.status(500).json({ error: 'Fehler beim Abrufen der Lieferscheine' });
    }
  }

  // POST /link
  async linkDocuments(req, res) {
    try {
      const { rechnungId, lieferscheinIds } = req.body;

      if (!rechnungId || !lieferscheinIds || !Array.isArray(lieferscheinIds)) {
        return res.status(400).json({ error: 'rechnungId und lieferscheinIds (Array) sind erforderlich.' });
      }

      const result = await purchaseDocumentService.linkLieferscheineToRechnung(
        rechnungId,
        lieferscheinIds,
        req.user.id
      );

      res.json({
        message: `${result.count} Lieferschein(e) erfolgreich verknüpft.`,
        ...result
      });
    } catch (error) {
      console.error('Link documents error:', error);
      res.status(500).json({ error: 'Fehler beim Verknüpfen der Belege' });
    }
  }
  // POST /:id/mark-paid
  async markAsPaid(req, res) {
    try {
      const { id } = req.params;
      const { paymentMethod } = req.body;

      if (!paymentMethod) {
        return res.status(400).json({ error: 'paymentMethod ist erforderlich.' });
      }

      const document = await purchaseDocumentService.markAsPaid(
        id,
        paymentMethod,
        req.user.id
      );

      res.json(document);
    } catch (error) {
      console.error('Mark as paid error:', error);
      res.status(500).json({ error: error.message });
    }
  }
  // POST /:id/mark-unpaid
  async markAsUnpaid(req, res) {
    try {
      const { id } = req.params;

      const document = await purchaseDocumentService.markAsUnpaid(
        id,
        req.user.id
      );

      res.json(document);
    } catch (error) {
      console.error('Mark as unpaid error:', error);
      res.status(500).json({ error: error.message });
    }
  }
  // POST /unlink
  async unlinkDocuments(req, res) {
    try {
      const { lieferscheinIds } = req.body;

      if (!lieferscheinIds || !Array.isArray(lieferscheinIds)) {
        return res.status(400).json({ error: 'lieferscheinIds (Array) sind erforderlich.' });
      }

      const result = await purchaseDocumentService.unlinkLieferscheine(
        lieferscheinIds,
        req.user.id
      );

      res.json({
        message: `${result.count} Lieferschein(e) erfolgreich entknüpft.`,
        ...result
      });
    } catch (error) {
      console.error('Unlink documents error:', error);
      res.status(500).json({ error: 'Fehler beim Entknüpfen der Belege' });
    }
  }

  // PATCH /:id
  async updateDocument(req, res) {
    try {
      const { id } = req.params;
      const data = req.body;

      let nachweisUrl = undefined;
      if (req.file) {
        nachweisUrl = req.file.path.replace(process.cwd(), '').replace(/\\/g, '/');
      }
      // HINWEIS: Wenn der User 'nachweisUrl' auf 'null' setzt (Datei löschen),
      // müssen wir das im Frontend separat senden. Aktuell wird nur 'undefined' (nicht ändern)
      // oder 'string' (neue Datei) unterstützt.

      // 'items' wird als JSON-String übermittelt
      if (data.items) {
        try {
          data.items = JSON.parse(data.items);
        } catch (e) {
          return res.status(400).json({ error: "Ungültiges 'items' Format." });
        }
      }

      // Datentypen aus FormData konvertieren
      if (data.totalAmount) data.totalAmount = parseFloat(data.totalAmount);
      if (data.paid !== undefined) data.paid = data.paid === 'true';

      const document = await purchaseDocumentService.updateDocument(
        id,
        data, // Enthält jetzt 'items'
        req.user.id,
        nachweisUrl
      );

      res.json(document);
    } catch (error) {
      console.error('Update document error:', error);
      res.status(500).json({ error: 'Fehler beim Aktualisieren des Belegs', details: error.message });
    }
  }
  // DELETE /:id
  async deleteDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await purchaseDocumentService.deleteDocument(
        id,
        req.user.id
      );

      res.json({ message: `Beleg ${document.documentNumber} erfolgreich gelöscht.` });
    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({ error: 'Fehler beim Löschen des Belegs', details: error.message });
    }
  }


  // TODO:
  // async updateDocument(req, res) { ... }
  // async deleteDocument(req, res) { ... }
}

module.exports = new PurchaseDocumentController();
