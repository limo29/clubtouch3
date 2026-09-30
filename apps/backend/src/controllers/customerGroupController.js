// controllers/customerGroupController.js
const customerGroupService = require('../services/customerGroupService');
const fileUploadService = require('../services/fileUploadService');
const prisma = require('../utils/prisma');

function triggerRefreshBoards() {
  try {
    const hs = require('../services/highscoreService');
    Promise.resolve(hs.refreshBoards?.()).catch((err) =>
      console.error('[CustomerGroupController] refreshBoards Fehler:', err)
    );
  } catch (err) {
    console.error('[CustomerGroupController] highscoreService laden fehlgeschlagen:', err);
  }
}

class CustomerGroupController {
  // GET /api/customer-groups
  async listGroups(req, res) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const groups = await customerGroupService.listGroups(includeInactive);
      res.json({ groups });
    } catch (err) {
      console.error('List groups error:', err);
      res.status(500).json({ error: 'Fehler beim Abrufen der Gruppen' });
    }
  }

  // POST /api/customer-groups
  async createGroup(req, res) {
    try {
      const group = await customerGroupService.createGroup(req.body);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE_CUSTOMER_GROUP',
          entityType: 'CustomerGroup',
          entityId: group.id,
          changes: req.body,
        },
      });

      triggerRefreshBoards();
      res.status(201).json({ group });
    } catch (err) {
      console.error('Create group error:', err);
      if (err.code === 'NAME_TAKEN') {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: 'Fehler beim Erstellen der Gruppe' });
    }
  }

  // PUT /api/customer-groups/:id
  async updateGroup(req, res) {
    try {
      const { id } = req.params;
      const existing = await customerGroupService.findById(id);
      if (!existing) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

      const group = await customerGroupService.updateGroup(id, req.body);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_CUSTOMER_GROUP',
          entityType: 'CustomerGroup',
          entityId: id,
          changes: req.body,
        },
      });

      triggerRefreshBoards();

      // memberCount aus DB holen für konsistente Antwort
      const full = await customerGroupService.findById(id);
      res.json({ group: full });
    } catch (err) {
      console.error('Update group error:', err);
      if (err.code === 'NAME_TAKEN') {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: 'Fehler beim Aktualisieren der Gruppe' });
    }
  }

  // DELETE /api/customer-groups/:id
  async deleteGroup(req, res) {
    try {
      const { id } = req.params;
      const existing = await customerGroupService.findById(id);
      if (!existing) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

      // Altes Bild löschen, falls vorhanden
      if (existing.imageUrl) {
        await fileUploadService.deleteGroupImage(existing.imageUrl);
      }

      await customerGroupService.deleteGroup(id);

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'DELETE_CUSTOMER_GROUP',
          entityType: 'CustomerGroup',
          entityId: id,
          changes: { name: existing.name },
        },
      });

      triggerRefreshBoards();
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete group error:', err);
      res.status(500).json({ error: 'Fehler beim Löschen der Gruppe' });
    }
  }

  // POST /api/customer-groups/:id/image
  async uploadGroupImage(req, res) {
    try {
      const { id } = req.params;
      const existing = await customerGroupService.findById(id);
      if (!existing) return res.status(404).json({ error: 'Gruppe nicht gefunden' });
      if (!req.file) return res.status(400).json({ error: 'Kein Bild hochgeladen' });

      // Altes Bild löschen
      if (existing.imageUrl) {
        await fileUploadService.deleteGroupImage(existing.imageUrl);
      }

      const imageUrl = await fileUploadService.processGroupImage(req.file);
      await customerGroupService.updateGroup(id, { imageUrl });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_CUSTOMER_GROUP_IMAGE',
          entityType: 'CustomerGroup',
          entityId: id,
          changes: { imageUrl },
        },
      });

      triggerRefreshBoards();

      const group = await customerGroupService.findById(id);
      res.json({ group });
    } catch (err) {
      console.error('Upload group image error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Datei zu groß (max. 5 MB)' });
      }
      res.status(500).json({ error: 'Fehler beim Hochladen des Gruppenbilds' });
    }
  }

  // DELETE /api/customer-groups/:id/image
  async deleteGroupImage(req, res) {
    try {
      const { id } = req.params;
      const existing = await customerGroupService.findById(id);
      if (!existing) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

      if (existing.imageUrl) {
        await fileUploadService.deleteGroupImage(existing.imageUrl);
        await customerGroupService.updateGroup(id, { imageUrl: null });

        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'DELETE_CUSTOMER_GROUP_IMAGE',
            entityType: 'CustomerGroup',
            entityId: id,
            changes: { removedUrl: existing.imageUrl },
          },
        });
      }

      triggerRefreshBoards();

      const group = await customerGroupService.findById(id);
      res.json({ group });
    } catch (err) {
      console.error('Delete group image error:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Gruppenbilds' });
    }
  }
}

module.exports = new CustomerGroupController();
