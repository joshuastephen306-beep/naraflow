// src/utils/response.js
const successResponse = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

const errorResponse = (res, message = 'An error occurred', statusCode = 400, errors = null) => {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
};

const paginatedResponse = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination,
    timestamp: new Date().toISOString(),
  });
};

// src/utils/helpers.js
const { v4: uuidv4 } = require('uuid');

const generateReference = (prefix = 'NF') => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const formatCurrency = (amount, currency) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency,
  }).format(amount);
};

const getPagination = (page = 1, limit = 20) => {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  return { limit: parseInt(limit), offset, page: parseInt(page) };
};

const sanitizeUser = (user) => {
  const { password_hash, ...sanitized } = user;
  return sanitized;
};

const calculateFee = (amount, currency = 'USD') => {
  const feePercent = parseFloat(process.env.TRANSFER_FEE_PERCENT) || 1.5;
  const minFeeUSD = parseFloat(process.env.TRANSFER_FEE_MIN_USD) || 1.0;
  const maxFeeUSD = parseFloat(process.env.TRANSFER_FEE_MAX_USD) || 15.0;

  let fee = (amount * feePercent) / 100;
  
  // Convert min/max to requested currency if not USD
  if (currency === 'NGN') {
    fee = Math.max(fee, minFeeUSD * 1500); // Approximate NGN rate
    fee = Math.min(fee, maxFeeUSD * 1500);
  } else if (currency === 'GBP') {
    fee = Math.max(fee, minFeeUSD * 0.79);
    fee = Math.min(fee, maxFeeUSD * 0.79);
  } else {
    fee = Math.max(fee, minFeeUSD);
    fee = Math.min(fee, maxFeeUSD);
  }

  return parseFloat(fee.toFixed(2));
};

const isFraudulent = (transaction, userHistory) => {
  const flags = [];
  
  // Flag 1: Large single transaction
  if (transaction.send_amount > 5000 && transaction.send_currency === 'USD') {
    flags.push('Large transaction amount');
  }
  
  // Flag 2: Multiple transactions in short period
  if (userHistory && userHistory.length > 5) {
    const lastHour = userHistory.filter(t => {
      const diff = Date.now() - new Date(t.created_at).getTime();
      return diff < 3600000; // 1 hour
    });
    if (lastHour.length >= 5) flags.push('High transaction frequency');
  }

  return {
    flagged: flags.length > 0,
    reasons: flags,
  };
};

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  generateReference,
  formatCurrency,
  getPagination,
  sanitizeUser,
  calculateFee,
  isFraudulent,
};
