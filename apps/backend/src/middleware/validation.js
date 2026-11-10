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
    .optional({ values: 'falsy' })
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
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3 })
    .withMessage('Benutzername muss mindestens 3 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen und Unterstrich enthalten')
];

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Aktuelles Passwort erforderlich'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(PASSWORD_RULE)
    .withMessage('Passwort muss Groß-/Kleinbuchstaben und Zahlen enthalten')
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

const validateCustomer = [
  body('name')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('nickname')
    .optional()
    .trim(),
  // Gruppe
  body('groupId')
    .optional({ values: 'falsy' })
    .isUUID()
    .withMessage('groupId muss eine gültige UUID sein'),
  body('isGroupAccount')
    .optional()
    .isBoolean()
    .withMessage('isGroupAccount muss ein Boolean sein'),
  // Kontaktdaten (optional; CASHIER-Eingaben werden im Controller ignoriert)
  body('company')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 150 })
    .withMessage('Firma/Zusatz darf höchstens 150 Zeichen lang sein'),
  body('street')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 150 })
    .withMessage('Straße darf höchstens 150 Zeichen lang sein'),
  body('zip')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('PLZ darf höchstens 20 Zeichen lang sein'),
  body('city')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Ort darf höchstens 100 Zeichen lang sein'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Telefon darf höchstens 50 Zeichen lang sein'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('E-Mail-Adresse ist ungültig')
    .isLength({ max: 200 })
    .withMessage('E-Mail darf höchstens 200 Zeichen lang sein'),
];

const validateCustomerUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name muss mindestens 2 Zeichen lang sein'),
  body('nickname')
    .optional()
    .trim(),
  // Gruppe
  body('groupId')
    .optional({ values: 'falsy' })
    .isUUID()
    .withMessage('groupId muss eine gültige UUID sein'),
  body('isGroupAccount')
    .optional()
    .isBoolean()
    .withMessage('isGroupAccount muss ein Boolean sein'),
  // Kontaktdaten (optional; CASHIER-Eingaben werden im Controller ignoriert)
  body('company')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 150 })
    .withMessage('Firma/Zusatz darf höchstens 150 Zeichen lang sein'),
  body('street')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 150 })
    .withMessage('Straße darf höchstens 150 Zeichen lang sein'),
  body('zip')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 20 })
    .withMessage('PLZ darf höchstens 20 Zeichen lang sein'),
  body('city')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Ort darf höchstens 100 Zeichen lang sein'),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Telefon darf höchstens 50 Zeichen lang sein'),
  body('email')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('E-Mail-Adresse ist ungültig')
    .isLength({ max: 200 })
    .withMessage('E-Mail darf höchstens 200 Zeichen lang sein'),
];

// Offline-Warteschlange: Idempotenzschlüssel (8–64 Zeichen). clientCreatedAt wird nicht abgelehnt,
// sondern im Service geprüft und bei ungültigem/zu altem Wert ignoriert (utils/clientRequest.js).
const clientIdRule = () => body('clientId')
  .optional({ values: 'null' })
  .isString()
  .withMessage('clientId muss Text sein')
  .trim()
  .isLength({ min: 8, max: 64 })
  .withMessage('clientId muss zwischen 8 und 64 Zeichen lang sein');

const validateTopUp = [
  body('amount')
    .isFloat({ min: 0.01, max: 500 })
    .withMessage('Betrag muss zwischen 0.01 und 500 Euro liegen'),
  body('method')
    .isIn(['CASH', 'TRANSFER', 'CARD'])
    .withMessage('Ungültige Zahlungsmethode'),
  body('reference')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Referenz muss Text sein')
    .trim()
    .isLength({ max: 200 })
    .withMessage('Referenz darf höchstens 200 Zeichen lang sein'),
  clientIdRule()
];

// Kundengruppe anlegen/aktualisieren
const validateCustomerGroup = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 40 })
    .withMessage('Name muss zwischen 1 und 40 Zeichen lang sein'),
  body('color')
    .optional({ values: 'falsy' })
    .matches(/^#[0-9a-fA-F]{6}$/)
    .withMessage('Farbe muss im Format #rrggbb angegeben werden'),
  body('emoji')
    .optional({ values: 'falsy' })
    .isLength({ max: 16 })
    .withMessage('Emoji darf höchstens 16 Zeichen lang sein'),
  body('sortOrder')
    .optional({ values: 'falsy' })
    .isInt()
    .withMessage('sortOrder muss eine ganze Zahl sein'),
  body('active')
    .optional()
    .isBoolean()
    .withMessage('active muss ein Boolean sein'),
];

const validateCustomerGroupUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 40 })
    .withMessage('Name muss zwischen 1 und 40 Zeichen lang sein'),
  body('color')
    .optional({ values: 'falsy' })
    .matches(/^#[0-9a-fA-F]{6}$/)
    .withMessage('Farbe muss im Format #rrggbb angegeben werden'),
  body('emoji')
    .optional({ values: 'falsy' })
    .isLength({ max: 16 })
    .withMessage('Emoji darf höchstens 16 Zeichen lang sein'),
  body('sortOrder')
    .optional({ values: 'falsy' })
    .isInt()
    .withMessage('sortOrder muss eine ganze Zahl sein'),
  body('active')
    .optional()
    .isBoolean()
    .withMessage('active muss ein Boolean sein'),
];

// Kassenzählung: Stückelung = Objekt { "200": 0, ..., "0.01": 3 } mit nichtnegativen Ganzzahlen
const CASH_DENOMINATIONS = ['200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01'];
const validateCashCount = [
  body('denominations')
    .custom((value, { req }) => {
      // Anfangsbestand darf auch nur als Betrag kommen
      if ((value === undefined || value === null) && (req.body.isOpening === true || req.body.isOpening === 'true')) return true;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Stückelung (denominations) muss ein Objekt sein');
      }
      for (const [key, count] of Object.entries(value)) {
        if (!CASH_DENOMINATIONS.includes(String(Number(key)))) {
          throw new Error(`Unbekannte Stückelung: ${key}`);
        }
        if (count === null || count === undefined || count === '') continue;
        const n = Number(count);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`Anzahl für ${key} € muss eine nichtnegative ganze Zahl sein`);
        }
      }
      return true;
    }),
  body('note')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Notiz muss Text sein')
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notiz darf höchstens 1000 Zeichen lang sein')
];

// Kassenbewegung (Ein-/Auszahlung, sonstige Bar-Ein-/Ausgaben)
const CASH_MOVEMENT_TYPES = ['DEPOSIT_TO_BANK', 'WITHDRAWAL_FROM_BANK', 'OTHER_INCOME', 'OTHER_EXPENSE'];
const CASH_MOVEMENT_NOTE_REQUIRED = ['OTHER_INCOME', 'OTHER_EXPENSE'];
// Statuswechsel einer Kundenrechnung: bei PAID ist die Zahlungsart (nur bar oder Überweisung) Pflicht
const validateInvoiceStatus = [
  body('status')
    .isIn(['DRAFT', 'SENT', 'PAID', 'CANCELLED'])
    .withMessage('Ungültiger Status. Erlaubt: DRAFT, SENT, PAID, CANCELLED'),
  body('paymentMethod')
    .if(body('status').equals('PAID'))
    .isIn(['CASH', 'TRANSFER'])
    .withMessage('Zahlungsart fehlt oder ist ungültig. Erlaubt: CASH (bar) oder TRANSFER (Überweisung)'),
  body('paidAt')
    .optional({ values: 'falsy' })
    .custom((value) => {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new Error('Zahldatum ist ungültig');
      if (d.getTime() > Date.now() + 60 * 1000) throw new Error('Zahldatum darf nicht in der Zukunft liegen');
      return true;
    }),
  handleValidationErrors
];

const validateCashMovement = [
  body('type')
    .isIn(CASH_MOVEMENT_TYPES)
    .withMessage('Ungültiger Bewegungstyp. Erlaubt: DEPOSIT_TO_BANK, WITHDRAWAL_FROM_BANK, OTHER_INCOME, OTHER_EXPENSE'),
  body('amount')
    .custom((value) => {
      const n = Number(value);
      if (Number.isNaN(n) || n <= 0) throw new Error('Betrag muss eine positive Zahl größer als 0 sein');
      const str = String(value);
      const dot = str.indexOf('.');
      if (dot !== -1 && str.length - dot - 1 > 2) throw new Error('Betrag darf höchstens 2 Dezimalstellen haben');
      return true;
    }),
  body('occurredAt')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Datum muss ein gültiges ISO 8601-Datum sein')
    .custom((value) => {
      const d = new Date(value);
      if (d.getTime() > Date.now() + 60 * 1000) throw new Error('Datum darf nicht in der Zukunft liegen');
      return true;
    }),
  // Pflicht (min 3 Zeichen) wenn Typ OTHER_INCOME oder OTHER_EXPENSE
  body('note')
    .if(body('type').isIn(CASH_MOVEMENT_NOTE_REQUIRED))
    .trim()
    .notEmpty().withMessage('Notiz ist bei sonstigen Bareinnahmen/-ausgaben Pflicht')
    .isLength({ min: 3 }).withMessage('Notiz muss mindestens 3 Zeichen lang sein')
    .isLength({ max: 500 }).withMessage('Notiz darf höchstens 500 Zeichen lang sein'),
  // Allgemeine Längenprüfung (auch für Bank-Typen)
  body('note')
    .optional({ values: 'falsy' })
    .isString().withMessage('Notiz muss Text sein')
    .trim()
    .isLength({ max: 500 }).withMessage('Notiz darf höchstens 500 Zeichen lang sein'),
  body('bankAccount')
    .optional({ values: 'falsy' })
    .isString().withMessage('Kontoname muss Text sein')
    .trim()
    .isLength({ max: 100 }).withMessage('Kontoname darf höchstens 100 Zeichen lang sein'),
];

const validateSale = [
  body('type')
    .optional()
    .isIn(['SALE', 'OWNER_USE', 'EXPIRED'])
    .withMessage('Ungültiger Buchungstyp. Erlaubt: SALE, OWNER_USE, EXPIRED'),
  body('paymentMethod')
    .isIn(['CASH', 'ACCOUNT', 'CARD'])
    .withMessage('Ungültige Zahlungsmethode'),
  body('customerId')
    .if(body('paymentMethod').equals('ACCOUNT'))
    .notEmpty()
    .withMessage('Kunde erforderlich bei Zahlung per Kundenkonto'),
  body('customerId')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Kunden-ID muss Text sein'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Mindestens ein Artikel erforderlich'),
  body('items.*.articleId')
    .isString()
    .notEmpty()
    .withMessage('Artikel-ID erforderlich'),
  body('items.*.quantity')
    .isInt({ min: 1, max: 10000 })
    .withMessage('Menge muss eine ganze Zahl zwischen 1 und 10000 sein'),
  clientIdRule()
];


module.exports = {
  validateLogin,
  validateRegister,
  validateUserUpdate,
  validateChangePassword,
  validateArticle,
  validateArticleUpdate,
  validateCustomer,
  validateCustomerUpdate,
  validateCustomerGroup,
  validateCustomerGroupUpdate,
  validateTopUp,
  validateSale,
  validateCashCount,
  validateCashMovement,
  validateInvoiceStatus,

  handleValidationErrors
};
