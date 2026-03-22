// src/services/paystack.js
const axios = require('axios');
const crypto = require('crypto');

const paystack = axios.create({
  baseURL: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ============================================
// INITIALIZE TRANSACTION (Receive Money)
// ============================================
const initializeTransaction = async ({ amount, email, currency, reference, callbackUrl, metadata }) => {
  try {
    const response = await paystack.post('/transaction/initialize', {
      amount: Math.round(parseFloat(amount) * 100), // Paystack uses kobo
      email,
      currency: currency || 'NGN',
      reference,
      callback_url: callbackUrl || `${process.env.FRONTEND_URL}/payment/callback`,
      metadata: {
        custom_fields: [],
        ...metadata,
      },
    });

    if (response.data.status) {
      return {
        success: true,
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference: response.data.data.reference,
      };
    }
    return { success: false, error: response.data.message };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      return {
        success: true,
        authorizationUrl: `https://checkout.paystack.com/${reference}`,
        reference,
        simulated: true,
      };
    }
    return { success: false, error: err.message };
  }
};

// ============================================
// VERIFY TRANSACTION
// ============================================
const verifyTransaction = async (reference) => {
  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);
    
    if (response.data.status && response.data.data.status === 'success') {
      const txn = response.data.data;
      return {
        success: true,
        verified: true,
        amount: txn.amount / 100, // Convert from kobo
        currency: txn.currency,
        reference: txn.reference,
        customerEmail: txn.customer?.email,
        raw: txn,
      };
    }
    return { success: false, verified: false, error: 'Transaction not successful' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ============================================
// TRANSFER (Withdrawal to Nigerian Bank)
// ============================================
const createTransferRecipient = async ({ type, name, accountNumber, bankCode, currency }) => {
  try {
    const response = await paystack.post('/transferrecipient', {
      type: type || 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: currency || 'NGN',
    });

    if (response.data.status) {
      return {
        success: true,
        recipientCode: response.data.data.recipient_code,
        id: response.data.data.id,
      };
    }
    return { success: false, error: response.data.message };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

const initiateTransfer = async ({ amount, recipient, reason, reference }) => {
  try {
    const response = await paystack.post('/transfer', {
      source: 'balance',
      amount: Math.round(parseFloat(amount) * 100),
      recipient,
      reason: reason || 'NaraFlow Withdrawal',
      reference,
    });

    if (response.data.status) {
      return {
        success: true,
        transferCode: response.data.data.transfer_code,
        status: response.data.data.status,
        reference: response.data.data.reference,
      };
    }
    return { success: false, error: response.data.message };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ============================================
// RESOLVE ACCOUNT
// ============================================
const resolveAccount = async (accountNumber, bankCode) => {
  try {
    const response = await paystack.get(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
    );

    if (response.data.status) {
      return {
        success: true,
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      };
    }
    return { success: false, error: 'Could not resolve account' };
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      return {
        success: true,
        accountName: 'SIMULATED ACCOUNT',
        accountNumber,
        simulated: true,
      };
    }
    return { success: false, error: err.message };
  }
};

// ============================================
// VERIFY WEBHOOK SIGNATURE
// ============================================
const verifyWebhookSignature = (payload, signature) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
};

// ============================================
// GET BANKS
// ============================================
const getBanks = async (country = 'nigeria') => {
  try {
    const response = await paystack.get(`/bank?country=${country}&perPage=100`);
    if (response.data.status) {
      return { success: true, banks: response.data.data };
    }
    return { success: false, banks: [] };
  } catch (err) {
    return { success: false, banks: [] };
  }
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  resolveAccount,
  verifyWebhookSignature,
  getBanks,
};
