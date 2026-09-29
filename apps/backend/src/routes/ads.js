const express = require('express');
const router = express.Router();
const adController = require('../controllers/adController');
const { authenticate, authorize } = require('../middleware/auth');

const upload = require('../middleware/upload');

// All routes require Auth and Admin role
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/', adController.listAds);
router.post('/', upload.single('image'), adController.createAd);
router.put('/reorder', adController.reorderAds); // Specific route before :id
router.put('/:id', upload.single('image'), adController.updateAd);
router.delete('/:id', adController.deleteAd);

// Upload-Fehler (zu groß, falscher Typ) als 400 mit verständlicher Meldung statt 500
router.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Datei zu groß (maximal 500 MB)' });
    }
    if (err && (err.name === 'MulterError' || /Bilder und Videos/.test(err.message || ''))) {
        return res.status(400).json({ error: err.message || 'Upload fehlgeschlagen' });
    }
    next(err);
});

module.exports = router;
