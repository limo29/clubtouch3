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

module.exports = router;
