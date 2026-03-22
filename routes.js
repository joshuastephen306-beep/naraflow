// src/routes/payment.routes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireKYC } = require('../middleware/auth');
const { transferLimiter } = require('../middleware/rateLimit');
const { sendMoneyValidator, withdrawValidator } = require('../middleware/validate');
const ctrl = require('../controllers/payment.controller');

router.get('/quote', authenticate, ctrl.getQuote);
router.get('/resolve-account', authenticate, ctrl.resolveBankAccountCtrl);
router.post('/send', authenticate, requireKYC, transferLimiter, sendMoneyValidator, ctrl.sendMoney);
router.post('/receive', authenticate, ctrl.receiveMoney);
router.post('/withdraw', authenticate, requireKYC, transferLimiter, withdrawValidator, ctrl.withdrawMoney);

module.exports = router;

// ─────────────────────────────────────────────
// src/routes/kyc.routes.js
const express2 = require('express');
const multer = require('multer');
const path = require('path');
const router2 = express2.Router();
const { authenticate: auth2 } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const kycCtrl = require('../controllers/kyc.controller');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/kyc';
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user?.id || 'unknown'}-${file.fieldname}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only JPG, PNG, PDF files are allowed'));
  },
});

router2.get('/status', auth2, kycCtrl.getKYCStatus);
router2.post(
  '/submit',
  auth2,
  upload.fields([{ name: 'id_document', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]),
  kycCtrl.submitKYC
);
router2.get('/list', auth2, requireAdmin, kycCtrl.listKYC);
router2.put('/review/:userId', auth2, requireAdmin, kycCtrl.reviewKYC);

module.exports = { paymentRouter: router, kycRouter: router2 };

// ─────────────────────────────────────────────
// src/routes/admin.routes.js
const express3 = require('express');
const router3 = express3.Router();
const { authenticate: auth3, requireAdmin: ra } = require('../middleware/auth');
const adminCtrl = require('../controllers/admin.controller');

router3.get('/stats', auth3, ra, adminCtrl.getDashboardStats);
router3.get('/users', auth3, ra, adminCtrl.listUsers);
router3.get('/users/:userId', auth3, ra, adminCtrl.getUserDetail);
router3.put('/users/:userId/status', auth3, ra, adminCtrl.updateUserStatus);
router3.get('/transactions', auth3, ra, adminCtrl.listTransactions);
router3.put('/transactions/:transactionId/resolve', auth3, ra, adminCtrl.resolveFlaggedTransaction);

module.exports = router3;

// ─────────────────────────────────────────────
// src/routes/notification.routes.js
const express4 = require('express');
const router4 = express4.Router();
const { authenticate: auth4 } = require('../middleware/auth');
const { getUserNotifications, markAsRead, markAllAsRead } = require('../services/notification');
const { successResponse, errorResponse } = require('../utils/helpers');

router4.get('/', auth4, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getUserNotifications(req.user.id, page, limit);
  return successResponse(res, data);
});

router4.put('/:id/read', auth4, async (req, res) => {
  await markAsRead(req.user.id, req.params.id);
  return successResponse(res, {}, 'Marked as read');
});

router4.put('/read-all', auth4, async (req, res) => {
  await markAllAsRead(req.user.id);
  return successResponse(res, {}, 'All marked as read');
});

module.exports = router4;
