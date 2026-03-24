// src/routes/wallet.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { bankAccountValidator } = require('../middleware/validate');
const ctrl = require('../controllers/wallet.controller');

router.get('/balances', authenticate, ctrl.getBalances);
router.get('/transactions', authenticate, ctrl.getTransactions);
router.get('/transactions/:reference', authenticate, ctrl.getTransaction);
router.get('/exchange-rate', authenticate, ctrl.exchangeRate);
router.get('/banks', authenticate, ctrl.getNigerianBanks);
router.get('/bank-accounts', authenticate, ctrl.getBankAccounts);
router.post('/bank-accounts', authenticate, bankAccountValidator, ctrl.addBankAccount);
router.delete('/bank-accounts/:id', authenticate, ctrl.deleteBankAccount);

module.exports = router;
