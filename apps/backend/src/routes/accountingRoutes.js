const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const accountingController = require('../controllers/accountingController');

router.use(authenticate);

router.get('/profit-loss', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.profitLoss);

router.get('/fiscal-years', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.listFiscalYears);
router.post('/fiscal-years', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.createFiscalYear);

router.get('/fiscal-years/:id/preview', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.fiscalYearPreview);
router.post('/fiscal-years/:id/close', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.closeFiscalYear);

// PDF Abschlussbericht
router.get('/fiscal-years/:id/report', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.yearEndReportPDF);

// Belegliste + ZIP für ein Geschäftsjahr (Kassenprüfer-Export)
router.get('/fiscal-years/:id/receipts', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.fiscalYearReceipts);
router.get('/fiscal-years/:id/receipts.zip', authorize('ADMIN','ACCOUNTANT','CASHIER'), accountingController.fiscalYearReceiptsZip);

module.exports = router;
