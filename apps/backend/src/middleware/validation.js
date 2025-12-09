const { body, validationResult } = require('express-validator');

// Validation Rules 
const validateLogin = [
  body()
    .custom((value, { req }) => {
      if (!req.body.email && !req.body.identifier) {
        throw new Error('Email oder Benutzername ist erforderlich');
      }
      return true;
    }),
  body('password')
    .notEmpty()
    .withMessage('Passwort erforderlich')
];

const validateRegister = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Bitte gültige E-Mail-Adresse eingeben'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Passwort muss Groß-/Kleinbuchstaben und Zahlen enthalten'),
  body('name')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('role')
    .optional()
    .isIn(['ADMIN', 'CASHIER', 'ACCOUNTANT'])
    .withMessage('Ungültige Rolle'),
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Benutzername muss mindestens 3 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen und Unterstrich enthalten')
];

// Validation Error Handler 
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: errors.array()
    });
  }
  next();
}

const validateUserUpdate = [
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Bitte gültige E-Mail-Adresse eingeben'),
  body('password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Passwort muss Groß-/Kleinbuchstaben und Zahlen enthalten'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('role')
    .optional()
    .isIn(['ADMIN', 'CASHIER', 'ACCOUNTANT'])
    .withMessage('Ungültige Rolle'),
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Benutzername muss mindestens 3 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen und Unterstrich enthalten')
];

const validateArticle = [
  body('name')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Preis muss eine positive Zahl sein'),
  body('category')
    .trim()
    .notEmpty()
    .withMessage('Kategorie ist erforderlich'),
  body('unit')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Einheit darf nicht leer sein'),
  body('minStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Mindestbestand muss eine positive Ganzzahl sein'),
  body('initialStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Anfangsbestand muss eine positive Ganzzahl sein')
];

const validateArticleUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Preis muss eine positive Zahl sein'),
  body('category')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Kategorie darf nicht leer sein'),
  body('stockAdjustment')
    .optional()
    .isInt()
    .withMessage('Bestandsanpassung muss eine Ganzzahl sein')
];

const validateDelivery = [
  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Menge muss eine positive Ganzzahl sein'),
  body('reason')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Grund darf nicht leer sein')
];

const validateInventory = [
  body('actualStock')
    .isInt({ min: 0 })
    .withMessage('Bestand muss eine positive Ganzzahl sein'),
  body('reason')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Grund darf nicht leer sein')
];

const validateCustomer = [
  body('name')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('nickname')
    .optional()
    .trim()
];

const validateCustomerUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('nickname')
    .optional()
    .trim()
];

const validateTopUp = [
  body('amount')
    .isFloat({ min: 0.01, max: 500 })
    .withMessage('Betrag muss zwischen 0.01 und 500 Euro liegen'),
  body('method')
    .isIn(['CASH', 'TRANSFER'])
    .withMessage('Ungültige Zahlungsmethode'),
  body('reference')
    .optional()
    .trim()
];

const validateSale = [
  body('paymentMethod')
    .isIn(['CASH', 'ACCOUNT'])
    .withMessage('Ungültige Zahlungsmethode'),
  body('customerId')
    .if(body('paymentMethod').equals('ACCOUNT'))
    .notEmpty()
    .withMessage('Kunde erforderlich bei Zahlung per Kundenkonto'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Mindestens ein Artikel erforderlich'),
  body('items.*.articleId')
    .notEmpty()
    .withMessage('Artikel-ID erforderlich'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Menge muss mindestens 1 sein')
];

const validateQuickSale = [
  body('articleId')
    .notEmpty()
    .withMessage('Artikel-ID erforderlich'),
  body('quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Menge muss mindestens 1 sein'),
  body('paymentMethod')
    .optional()
    .isIn(['CASH', 'ACCOUNT'])
    .withMessage('Ungültige Zahlungsmethode')
];


module.exports = {
  validateLogin,
  validateRegister,
  validateUserUpdate,
  validateArticle,
  validateArticleUpdate,
  validateDelivery,
  validateInventory,
  validateCustomer,
  validateCustomerUpdate,
  validateTopUp,
  validateSale,
  validateQuickSale,

  handleValidationErrors
};


