// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit');
const { registerValidator, loginValidator } = require('../middleware/validate');
const ctrl = require('../controllers/auth.controller');

router.post('/register', authLimiter, registerValidator, ctrl.register);
router.post('/login', authLimiter, loginValidator, ctrl.login);
router.post('/refresh-token', ctrl.refreshToken);
router.post('/logout', authenticate, ctrl.logout);
router.post('/forgot-password', otpLimiter, ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);
router.post('/verify-email', authenticate, ctrl.verifyEmail);
router.post('/send-phone-otp', authenticate, otpLimiter, ctrl.sendPhoneOTP);
router.post('/verify-phone', authenticate, ctrl.verifyPhone);
router.get('/profile', authenticate, ctrl.getProfile);
router.put('/profile', authenticate, ctrl.updateProfile);

module.exports = router;
