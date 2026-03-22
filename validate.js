// src/middleware/validate.js
const { validationResult, body, param, query: queryValidator } = require('express-validator');
const { errorResponse } = require('../utils/helpers');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, 'Validation failed', 422, errors.array());
  }
  next();
};

// Auth validators
const registerValidator = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Z])(?=.*[0-9])/)
    .withMessage('Password must contain at least one uppercase letter and one number'),
  body('first_name').trim().isLength({ min: 2, max: 100 }).withMessage('First name required (2-100 chars)'),
  body('last_name').trim().isLength({ min: 2, max: 100 }).withMessage('Last name required (2-100 chars)'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  body('country').isISO31661Alpha2().withMessage('Valid country code required (e.g. NG, US, GB)'),
  handleValidation,
];

const loginValidator = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  handleValidation,
];

// Payment validators
const sendMoneyValidator = [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('send_currency').isIn(['NGN', 'USD', 'GBP', 'EUR']).withMessage('Unsupported currency'),
  body('receive_currency').isIn(['NGN', 'USD', 'GBP', 'EUR']).withMessage('Unsupported receive currency'),
  body('recipient_type').isIn(['bank', 'wallet']).withMessage('Recipient type must be bank or wallet'),
  // Bank transfer fields
  body('recipient_account_number')
    .if(body('recipient_type').equals('bank'))
    .notEmpty().withMessage('Recipient account number required'),
  body('recipient_bank_code')
    .if(body('recipient_type').equals('bank'))
    .notEmpty().withMessage('Recipient bank code required'),
  body('recipient_name').notEmpty().withMessage('Recipient name required'),
  handleValidation,
];

const withdrawValidator = [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal is 100 NGN'),
  body('bank_account_id').isUUID().withMessage('Valid bank account ID required'),
  handleValidation,
];

const bankAccountValidator = [
  body('bank_name').notEmpty().withMessage('Bank name required'),
  body('bank_code').notEmpty().withMessage('Bank code required'),
  body('account_number').isLength({ min: 10, max: 10 }).withMessage('Account number must be 10 digits'),
  body('account_name').notEmpty().withMessage('Account name required'),
  handleValidation,
];

module.exports = {
  handleValidation,
  registerValidator,
  loginValidator,
  sendMoneyValidator,
  withdrawValidator,
  bankAccountValidator,
};
