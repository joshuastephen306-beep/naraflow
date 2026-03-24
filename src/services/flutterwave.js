// src/services/flutterwave.js
const axios = require('axios');
const crypto = require('crypto');

const flw = axios.create({
  baseURL: process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3',
  headers: {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ============================================
// EXCHANGE RATES
// ============================================
const getExchangeRate = async (from, to) => {
  try {
    // Flutterwave doesn't have a dedicated rate endpoint in v3
    // We use their transfer simulation to get rates, or use ExchangeRate API as fallback
    const response = await axios.get(
      `${process.env.EXCHANGE_RATE_BASE_URL}/${process.env.EXCHANGE_RATE_API_KEY}/pair/${from}/${to}`,
      { timeout: 5000 }
    );
    
    if (response.data && response.data.conversion_rate) {
      return {
        success: true,
        rate: response.data.conversion_rate,
        from,
        to,
        provider: 'exchangerate-api',
      };
    }
    throw new Error('Rate not available');
  } catch (err) {
    // Hardcoded fallback rates (update these regularly in production)
    const fallbackRates = {
      'USD-NGN': 1580,
      'GBP-NGN': 1990,
      'EUR-NGN': 1710,
      'NGN-USD': 0.000633,
      'NGN-GBP': 0.000503,
      'USD-GBP': 0.79,
      'GBP-USD': 1.27,
      'EUR-USD': 1.08,
    };
    
    const key = `${from}-${to}`;
    if (fallbackRates[key]) {
      return { success: true, rate: fallbackRates[key], from, to, provider: 'fallback' };
    }
    
    return { success: false, error: 'Exchange rate not available' };
  }
};

// ============================================
// BANK TRANSFER (Send to Nigerian Bank)
// ============================================
const initiateBankTransfer = async ({ amount, currency, bankCode, accountNumber, accountName, narration, reference }) => {
  try {
    const payload = {
      account_bank: bankCode,
      account_number: accountNumber,
      amount: parseFloat(amount),
      narration: narration || 'NaraFlow Transfer',
      currency: currency || 'NGN',
      reference,
      callback_url: `${process.env.FRONTEND_URL}/webhook/flutterwave`,
      debit_currency: 'NGN',
    };

    const response = await flw.post('/transfers', payload);
    
    if (response.data.status === 'success') {
      return {
        success: true,
        transferId: response.data.data.id,
        status: response.data.data.status,
        reference: response.data.data.reference,
        raw: response.data.data,
      };
    }

    return { success: false, error: response.data.message };
  } catch (err) {
    console.error('FLW transfer error:', err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.message || 'Transfer initiation failed',
    };
  }
};

// ============================================
// PAYMENT LINK (For receiving money)
// ============================================
const createPaymentLink = async ({ amount, currency, email, name, reference, redirectUrl }) => {
  try {
    const payload = {
      tx_ref: reference,
      amount: parseFloat(amount),
      currency: currency || 'USD',
      redirect_url: redirectUrl || `${process.env.FRONTEND_URL}/payment/callback`,
      customer: { email, name },
      customizations: {
        title: 'NaraFlow Payment',
        description: 'Send money to Nigeria',
        logo: 'https://naraflow.com/logo.png',
      },
    };

    const response = await flw.post('/payments', payload);
    
    if (response.data.status === 'success') {
      return {
        success: true,
        paymentLink: response.data.data.link,
        reference,
      };
    }
    return { success: false, error: response.data.message };
  } catch (err) {
    // In TEST/DEV mode, simulate payment link
    if (process.env.NODE_ENV !== 'production') {
      return {
        success: true,
        paymentLink: `https://checkout.flutterwave.com/v3/hosted/pay/${reference}`,
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
const verifyTransaction = async (transactionId) => {
  try {
    const response = await flw.get(`/transactions/${transactionId}/verify`);
    
    if (response.data.status === 'success') {
      const txn = response.data.data;
      return {
        success: true,
        verified: txn.status === 'successful',
        amount: txn.amount,
        currency: txn.currency,
        reference: txn.tx_ref,
        flwRef: txn.flw_ref,
        customerEmail: txn.customer?.email,
        raw: txn,
      };
    }
    return { success: false, error: 'Verification failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ============================================
// RESOLVE BANK ACCOUNT
// ============================================
const resolveBankAccount = async (accountNumber, bankCode) => {
  try {
    const response = await flw.post('/accounts/resolve', {
      account_number: accountNumber,
      account_bank: bankCode,
    });

    if (response.data.status === 'success') {
      return {
        success: true,
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
      };
    }
    return { success: false, error: 'Could not resolve account' };
  } catch (err) {
    // Simulate for development
    if (process.env.NODE_ENV !== 'production') {
      return {
        success: true,
        accountName: 'SIMULATED ACCOUNT NAME',
        accountNumber,
        simulated: true,
      };
    }
    return { success: false, error: err.response?.data?.message || 'Account resolution failed' };
  }
};

// ============================================
// GET NIGERIAN BANKS LIST
// ============================================
const getNigerianBanks = async () => {
  try {
    const response = await flw.get('/banks/NG');
    if (response.data.status === 'success') {
      return { success: true, banks: response.data.data };
    }
    return { success: false, banks: [] };
  } catch (err) {
    // Return common Nigerian banks as fallback
    return {
      success: true,
      banks: [
        { code: '044', name: 'Access Bank' },
        { code: '063', name: 'Access Bank (Diamond)' },
        { code: '035A', name: 'ALAT by WEMA' },
        { code: '401', name: 'ASO Savings and Loans' },
        { code: '023', name: 'Citibank Nigeria' },
        { code: '050', name: 'EcoBank Nigeria' },
        { code: '562', name: 'Ekondo Microfinance Bank' },
        { code: '070', name: 'Fidelity Bank' },
        { code: '011', name: 'First Bank of Nigeria' },
        { code: '214', name: 'First City Monument Bank' },
        { code: '058', name: 'Guaranty Trust Bank' },
        { code: '030', name: 'Heritage Bank' },
        { code: '301', name: 'Jaiz Bank' },
        { code: '082', name: 'Keystone Bank' },
        { code: '526', name: 'Parallex Bank' },
        { code: '076', name: 'Polaris Bank' },
        { code: '101', name: 'Providus Bank' },
        { code: '221', name: 'Stanbic IBTC Bank' },
        { code: '068', name: 'Standard Chartered Bank' },
        { code: '232', name: 'Sterling Bank' },
        { code: '100', name: 'SunTrust Bank' },
        { code: '032', name: 'Union Bank of Nigeria' },
        { code: '033', name: 'United Bank For Africa' },
        { code: '215', name: 'Unity Bank' },
        { code: '035', name: 'Wema Bank' },
        { code: '057', name: 'Zenith Bank' },
        { code: '327', name: 'Kuda Bank' },
        { code: '090405', name: 'Moniepoint' },
        { code: '090267', name: 'OPay' },
        { code: '999992', name: 'PalmPay' },
      ],
      simulated: true,
    };
  }
};

// ============================================
// VERIFY WEBHOOK SIGNATURE
// ============================================
const verifyWebhookSignature = (payload, signature) => {
  const hash = crypto
    .createHmac('sha256', process.env.FLW_WEBHOOK_SECRET || '')
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
};

// ============================================
// GET TRANSFER STATUS
// ============================================
const getTransferStatus = async (transferId) => {
  try {
    const response = await flw.get(`/transfers/${transferId}`);
    if (response.data.status === 'success') {
      return {
        success: true,
        status: response.data.data.status,
        raw: response.data.data,
      };
    }
    return { success: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

module.exports = {
  getExchangeRate,
  initiateBankTransfer,
  createPaymentLink,
  verifyTransaction,
  resolveBankAccount,
  getNigerianBanks,
  verifyWebhookSignature,
  getTransferStatus,
};
