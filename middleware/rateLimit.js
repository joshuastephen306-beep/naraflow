// src/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const createLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter
const generalLimiter = createLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 min
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  'Too many requests. Please try again later.'
);

// Strict limiter for auth endpoints
const authLimiter = createLimiter(
  900000, // 15 min
  10,
  'Too many authentication attempts. Please try again in 15 minutes.'
);

// OTP limiter
const otpLimiter = createLimiter(
  600000, // 10 min
  5,
  'Too many OTP requests. Please try again in 10 minutes.'
);

// Transfer limiter
const transferLimiter = createLimiter(
  3600000, // 1 hour
  20,
  'Too many transfer attempts. Please try again later.'
);

module.exports = { generalLimiter, authLimiter, otpLimiter, transferLimiter };
