// src/middleware/auth.js
const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../config/database');
const { errorResponse } = require('../utils/helpers');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'Authentication required. Please provide a valid token.', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return errorResponse(res, 'Invalid or expired token. Please login again.', 401);
    }

    // Fetch user from DB (ensures user still exists + is active)
    const result = await query(
      `SELECT id, email, first_name, last_name, phone, phone_verified, email_verified, 
              country, currency_preference, role, status, avatar_url
       FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'User not found.', 401);
    }

    const user = result.rows[0];

    if (user.status === 'suspended') {
      return errorResponse(res, 'Your account has been suspended. Contact support.', 403);
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return errorResponse(res, 'Authentication failed.', 401);
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return errorResponse(res, 'Admin access required.', 403);
  }
  next();
};

const requireKYC = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT status FROM kyc_records WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0 || result.rows[0].status !== 'approved') {
      return errorResponse(res, 'KYC verification required to perform this action. Please complete your identity verification.', 403);
    }

    next();
  } catch (err) {
    return errorResponse(res, 'Could not verify KYC status.', 500);
  }
};

module.exports = { authenticate, requireAdmin, requireKYC };
