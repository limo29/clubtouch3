const { body, validationResult } = require('express-validator'); 
 
// Validation Rules 
const validateLogin = [ 
  body('email') 
    .isEmail() 
    .normalizeEmail() 
    .withMessage('Bitte gültige E-Mail-Adresse eingeben'), 
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
    .withMessage('Ungültige Rolle') 
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
 
module.exports = { 
  validateLogin, 
  validateRegister, 
  handleValidationErrors 
}; 
