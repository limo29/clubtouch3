const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const screenService = require('../services/screenService');
const { sendError } = require('../utils/httpError');
const { emitScreensUpdate, emitScreensIdentify } = require('../utils/websocket');
const prisma = require('../utils/prisma');

// Belegung der Bildschirme ändern: wie die Werbung für Admin und Kassierer
router.use(authenticate);
router.use(authorize('ADMIN', 'CASHIER'));

router.put('/', async (req, res) => {
  try {
    const screens = await screenService.setAssignment(req.body?.screens);
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'UPDATE_SCREENS', entityType: 'SystemSetting', entityId: 'screens.assignment', changes: screens } });
    emitScreensUpdate(screens);
    res.json({ screens });
  } catch (error) {
    sendError(res, error, 'Bildschirm-Belegung konnte nicht gespeichert werden');
  }
});

// Blendet auf allen Bildschirmen für ein paar Sekunden die eigene Nummer ein
router.post('/identify', (req, res) => {
  emitScreensIdentify();
  res.json({ ok: true });
});

module.exports = router;
