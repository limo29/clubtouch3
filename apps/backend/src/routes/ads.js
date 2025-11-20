const express = require('express');
const router = express.Router();
const adController = require('../controllers/adController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require Auth and Admin role
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/', adController.listAds);
router.post('/', adController.createAd);
router.put('/reorder', adController.reorderAds); // Specific route before :id
router.put('/:id', adController.updateAd);
router.delete('/:id', adController.deleteAd);

module.exports = router;
