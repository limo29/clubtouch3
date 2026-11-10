const purchaseDocumentService = require('../services/purchaseDocumentService');
const { toPublicUrl } = require('../utils/uploadsDir');
const receiptService = require('../services/receiptService');
const { parseLocalDate, endOfLocalDay } = require('../utils/businessDay');
const prisma = require('../utils/prisma');
const fs = require('fs');
const closedPeriod = require('../utils/closedPeriod');

// Fachliche Fehler (userFacing, statusCode 4xx) mit Meldung, sonst generische 500 ohne Interna
function sendError(res, error, fallback, label) {
  // Abgeschlossenes Geschäftsjahr ohne Bestätigung: 409 mit code/fiscalYear (das Frontend fragt nach)
  if (closedPeriod.sendClosedPeriod(res, error)) {
    // Hochgeladener Nachweis wäre verwaist; die Wiederholung mit Bestätigung lädt ihn erneut hoch
    if (res.req && res.req.file && res.req.file.path) fs.promises.unlink(res.req.file.path).catch(() => {});
    return;
  }
  if (error && (error.userFacing || (error.statusCode && error.statusCode < 500))) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }
  if (error && error.code === 'P2025') return res.status(404).json({ error: 'Beleg nicht gefunden' });
  console.error(label, error);
  return res.status(500).json({ error: fallback });
}

class PurchaseDocumentController {

  // POST /
  async createDocument(req, res) {
    try {
      const data = req.body;

      // Datei-Upload verarbeiten
      let nachweisUrl = null;
      if (req.file) {
        // voller Pfad → öffentliche URL /uploads/nachweise/xyz.pdf (Upload-Ordner ist konfigurierbar)
        nachweisUrl = toPublicUrl(req.file.path);
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

      // Datentypen konvertieren (aus FormData sind alles Strings); Betrag parst der Service ("12,50" -> 12.50)
      data.paid = data.paid === true || data.paid === 'true';
      if (data.reimbursedCustomerId === '') data.reimbursedCustomerId = undefined;

      const document = await purchaseDocumentService.createDocument(
        data,
        req.user.id,
        nachweisUrl,
        { confirmClosed: closedPeriod.isConfirmed(req) }
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
      sendError(res, error, 'Fehler beim Erstellen des Belegs', 'Create document error:');
    }
  }

  // GET /
  async listDocuments(req, res) {
    try {
      const filters = {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        paid: req.query.paid,
        search: req.query.search,
        supplier: req.query.supplier
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
  // GET /entered-by – Namen für die Auswahl „Eingetragen von“
  async getEnteredByNames(req, res) {
    try {
      const names = await purchaseDocumentService.getEnteredByNames();
      res.json({ names });
    } catch (error) {
      console.error('Get entered-by names error:', error);
      res.status(500).json({ error: 'Fehler beim Laden der Namen' });
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
      sendError(res, error, 'Fehler beim Verknüpfen der Belege', 'Link documents error:');
    }
  }
  // POST /:id/mark-paid
  async markAsPaid(req, res) {
    try {
      const { id } = req.params;
      const { paymentMethod, reimbursedCustomerId, paidAt } = req.body || {};

      if (!paymentMethod) {
        return res.status(400).json({ error: 'Zahlungsart (paymentMethod) ist erforderlich.' });
      }

      const document = await purchaseDocumentService.markAsPaid(
        id,
        paymentMethod,
        req.user.id,
        reimbursedCustomerId || null,
        paidAt,
        { confirmClosed: closedPeriod.isConfirmed(req) }
      );

      res.json(document);
    } catch (error) {
      sendError(res, error, 'Fehler beim Markieren als bezahlt', 'Mark as paid error:');
    }
  }
  // POST /:id/mark-unpaid
  async markAsUnpaid(req, res) {
    try {
      const { id } = req.params;

      const document = await purchaseDocumentService.markAsUnpaid(
        id,
        req.user.id,
        { confirmClosed: closedPeriod.isConfirmed(req) }
      );

      res.json(document);
    } catch (error) {
      sendError(res, error, 'Fehler beim Zurücksetzen der Zahlung', 'Mark as unpaid error:');
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
        nachweisUrl = toPublicUrl(req.file.path);
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

      // Datentypen aus FormData konvertieren; Betrag parst der Service, leerer Betrag = unverändert
      if (data.totalAmount === '') delete data.totalAmount;
      if (data.paid !== undefined) data.paid = data.paid === true || data.paid === 'true';
      if (data.reimbursedCustomerId === '') data.reimbursedCustomerId = undefined;

      const document = await purchaseDocumentService.updateDocument(
        id,
        data, // Enthält jetzt 'items'
        req.user.id,
        nachweisUrl,
        { confirmClosed: closedPeriod.isConfirmed(req) }
      );

      res.json(document);
    } catch (error) {
      sendError(res, error, 'Fehler beim Aktualisieren des Belegs', 'Update document error:');
    }
  }
  // DELETE /:id
  async deleteDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await purchaseDocumentService.deleteDocument(
        id,
        req.user.id,
        { confirmClosed: closedPeriod.isConfirmed(req) }
      );

      res.json({ message: `Beleg ${document.documentNumber} erfolgreich gelöscht.` });
    } catch (error) {
      sendError(res, error, 'Fehler beim Löschen des Belegs', 'Delete document error:');
    }
  }


  // GET /receipts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  async receipts(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate und endDate (YYYY-MM-DD) sind erforderlich.' });
      }
      const start = parseLocalDate(startDate);
      const end   = endOfLocalDay(endDate);
      if (!start || !end) {
        return res.status(400).json({ error: 'Ungültiges Datumsformat – erwartet YYYY-MM-DD.' });
      }
      const result = await receiptService.listReceipts(start, end);
      res.json(result);
    } catch (e) {
      console.error('receipts error', e);
      res.status(500).json({ error: 'Fehler beim Laden der Belege.' });
    }
  }

  // GET /receipts.zip?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  async receiptsZip(req, res) {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate und endDate (YYYY-MM-DD) sind erforderlich.' });
      }
      const start = parseLocalDate(startDate);
      const end   = endOfLocalDay(endDate);
      if (!start || !end) {
        return res.status(400).json({ error: 'Ungültiges Datumsformat – erwartet YYYY-MM-DD.' });
      }
      const { stream, filename } = await receiptService.buildReceiptZip(start, end, {
        name: 'Zeitraum',
        createdBy: req.user ? req.user.name : ''
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      stream.on('error', (err) => {
        console.error('ZIP-Stream-Fehler', err);
        if (!res.headersSent) res.status(500).json({ error: 'ZIP-Fehler' });
        else res.end();
      });
      stream.pipe(res);
    } catch (e) {
      console.error('receiptsZip error', e);
      res.status(500).json({ error: 'Fehler beim Erstellen des ZIP.' });
    }
  }
}

module.exports = new PurchaseDocumentController();
