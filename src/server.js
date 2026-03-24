// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================
// BODY PARSING
// ============================================
// Webhook routes need raw body for signature verification
app.use('/api/webhooks', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.body = JSON.parse(req.body);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// RATE LIMITING (Global)
// ============================================
app.use('/api', generalLimiter);

// ============================================
// STATIC FILES (KYC uploads)
// ============================================
app.use('/uploads', express.static('uploads'));

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'NaraFlow API',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// ROUTES
// ============================================
const authRoutes = require('./routes/auth.routes');
const walletRoutes = require('./routes/wallet.routes');
const { paymentRouter, kycRouter } = require('./routes/routes');
const adminRoutes = require('./routes/routes').default || require('./routes/routes');
const { flutterwaveWebhook, paystackWebhook } = require('./controllers/webhook.controller');

// Re-export admin routes properly
const express2 = require('express');
const adminRouter = express2.Router();
const { authenticate, requireAdmin } = require('./middleware/auth');
const adminCtrl = require('./controllers/admin.controller');
adminRouter.get('/stats', authenticate, requireAdmin, adminCtrl.getDashboardStats);
adminRouter.get('/users', authenticate, requireAdmin, adminCtrl.listUsers);
adminRouter.get('/users/:userId', authenticate, requireAdmin, adminCtrl.getUserDetail);
adminRouter.put('/users/:userId/status', authenticate, requireAdmin, adminCtrl.updateUserStatus);
adminRouter.get('/transactions', authenticate, requireAdmin, adminCtrl.listTransactions);
adminRouter.put('/transactions/:transactionId/resolve', authenticate, requireAdmin, adminCtrl.resolveFlaggedTransaction);

const notifRouter = express2.Router();
const { getUserNotifications, markAsRead, markAllAsRead } = require('./services/notification');
const { successResponse } = require('./utils/helpers');
notifRouter.get('/', authenticate, async (req, res) => {
  const data = await getUserNotifications(req.user.id, req.query.page, req.query.limit);
  successResponse(res, data);
});
notifRouter.put('/read-all', authenticate, async (req, res) => {
  await markAllAsRead(req.user.id);
  successResponse(res, {}, 'All marked as read');
});
notifRouter.put('/:id/read', authenticate, async (req, res) => {
  await markAsRead(req.user.id, req.params.id);
  successResponse(res, {}, 'Marked as read');
});

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRouter);
app.use('/api/kyc', kycRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notifRouter);

// Webhook endpoints (no auth, signature-verified)
app.post('/api/webhooks/flutterwave', flutterwaveWebhook);
app.post('/api/webhooks/paystack', paystackWebhook);

// ============================================
// 404 Handler
// ============================================
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ============================================
// Global Error Handler
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = parseInt(process.env.PORT) || 4000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════╗
║     🚀 NaraFlow API Running        ║
║     Port: ${PORT}                      ║
║     Env:  ${process.env.NODE_ENV || 'development'}              ║
╚════════════════════════════════════╝
    `);
  });
}

module.exports = app;
