// src/controllers/wallet.controller.js
const { query } = require('../config/database');
const { getUserWallets, getWallet } = require('../services/wallet');
const { getExchangeRate } = require('../services/flutterwave');
const { successResponse, errorResponse, paginatedResponse, getPagination } = require('../utils/helpers');

// ============================================
// GET ALL WALLETS + BALANCES
// ============================================
const getBalances = async (req, res) => {
  try {
    const wallets = await getUserWallets(req.user.id);
    
    // Get total balance in preferred currency (approximate)
    const preferredCurrency = req.user.currency_preference || 'NGN';
    
    return successResponse(res, {
      wallets,
      preferred_currency: preferredCurrency,
    });
  } catch (err) {
    return errorResponse(res, 'Could not fetch balances', 500);
  }
};

// ============================================
// GET TRANSACTION HISTORY
// ============================================
const getTransactions = async (req, res) => {
  const { page = 1, limit = 20, type, status, currency } = req.query;
  const { limit: lim, offset } = getPagination(page, limit);
  
  try {
    let whereClause = `WHERE (t.sender_id = $1 OR t.recipient_id = $1)`;
    const params = [req.user.id];
    let paramIndex = 2;
    
    if (type) {
      whereClause += ` AND t.type = $${paramIndex++}`;
      params.push(type);
    }
    if (status) {
      whereClause += ` AND t.status = $${paramIndex++}`;
      params.push(status);
    }
    if (currency) {
      whereClause += ` AND (t.send_currency = $${paramIndex} OR t.receive_currency = $${paramIndex})`;
      params.push(currency);
      paramIndex++;
    }
    
    const countResult = await query(
      `SELECT COUNT(*) FROM transactions t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    
    const txnResult = await query(
      `SELECT 
         t.*,
         s.first_name || ' ' || s.last_name as sender_name,
         s.email as sender_email,
         r.first_name || ' ' || r.last_name as recipient_user_name,
         r.email as recipient_user_email
       FROM transactions t
       LEFT JOIN users s ON s.id = t.sender_id
       LEFT JOIN users r ON r.id = t.recipient_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, lim, offset]
    );
    
    return paginatedResponse(res, txnResult.rows, {
      page: parseInt(page),
      limit: lim,
      total,
      totalPages: Math.ceil(total / lim),
    });
  } catch (err) {
    console.error('Get transactions error:', err);
    return errorResponse(res, 'Could not fetch transactions', 500);
  }
};

// ============================================
// GET SINGLE TRANSACTION
// ============================================
const getTransaction = async (req, res) => {
  const { reference } = req.params;
  
  try {
    const result = await query(
      `SELECT t.*, 
         s.first_name || ' ' || s.last_name as sender_name,
         r.first_name || ' ' || r.last_name as recipient_user_name
       FROM transactions t
       LEFT JOIN users s ON s.id = t.sender_id
       LEFT JOIN users r ON r.id = t.recipient_id
       WHERE t.reference = $1 AND (t.sender_id = $2 OR t.recipient_id = $2)`,
      [reference, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return errorResponse(res, 'Transaction not found', 404);
    }
    
    return successResponse(res, { transaction: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 'Could not fetch transaction', 500);
  }
};

// ============================================
// GET EXCHANGE RATE
// ============================================
const exchangeRate = async (req, res) => {
  const { from, to, amount } = req.query;
  
  if (!from || !to) {
    return errorResponse(res, 'from and to currencies required', 400);
  }
  
  try {
    // Check cached rate first
    const cached = await query(
      `SELECT * FROM exchange_rates 
       WHERE from_currency = $1 AND to_currency = $2 
       AND fetched_at > NOW() - INTERVAL '1 hour'`,
      [from.toUpperCase(), to.toUpperCase()]
    );
    
    let rate;
    
    if (cached.rows.length > 0) {
      rate = parseFloat(cached.rows[0].rate);
    } else {
      const rateResult = await getExchangeRate(from.toUpperCase(), to.toUpperCase());
      if (!rateResult.success) {
        return errorResponse(res, 'Could not fetch exchange rate', 503);
      }
      rate = rateResult.rate;
      
      // Cache the rate
      await query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, provider)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (from_currency, to_currency) 
         DO UPDATE SET rate = $3, fetched_at = NOW()`,
        [from.toUpperCase(), to.toUpperCase(), rate, rateResult.provider]
      );
    }
    
    const sendAmount = parseFloat(amount) || 1;
    const receiveAmount = sendAmount * rate;
    
    return successResponse(res, {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate,
      send_amount: sendAmount,
      receive_amount: parseFloat(receiveAmount.toFixed(2)),
      provider: 'naraflow',
      cached_at: cached.rows[0]?.fetched_at || new Date(),
    });
  } catch (err) {
    return errorResponse(res, 'Exchange rate service unavailable', 503);
  }
};

// ============================================
// GET LINKED BANK ACCOUNTS
// ============================================
const getBankAccounts = async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    return successResponse(res, { bank_accounts: result.rows });
  } catch (err) {
    return errorResponse(res, 'Could not fetch bank accounts', 500);
  }
};

// ============================================
// ADD BANK ACCOUNT
// ============================================
const addBankAccount = async (req, res) => {
  const { bank_name, bank_code, account_number, account_name, country, currency } = req.body;
  
  try {
    // Check if account already linked
    const existing = await query(
      `SELECT id FROM bank_accounts WHERE user_id = $1 AND account_number = $2 AND bank_code = $3`,
      [req.user.id, account_number, bank_code]
    );
    
    if (existing.rows.length > 0) {
      return errorResponse(res, 'This bank account is already linked to your profile', 409);
    }
    
    // Check if this is their first bank account (set as default)
    const existingCount = await query(
      `SELECT COUNT(*) FROM bank_accounts WHERE user_id = $1`,
      [req.user.id]
    );
    const isDefault = parseInt(existingCount.rows[0].count) === 0;
    
    const result = await query(
      `INSERT INTO bank_accounts (user_id, bank_name, bank_code, account_number, account_name, country, currency, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id, bank_name, bank_code, account_number,
        account_name, country || 'NG', currency || 'NGN', isDefault
      ]
    );
    
    return successResponse(res, { bank_account: result.rows[0] }, 'Bank account added', 201);
  } catch (err) {
    return errorResponse(res, 'Could not add bank account', 500);
  }
};

// ============================================
// DELETE BANK ACCOUNT
// ============================================
const deleteBankAccount = async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await query(
      `DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return errorResponse(res, 'Bank account not found', 404);
    }
    
    return successResponse(res, {}, 'Bank account removed');
  } catch (err) {
    return errorResponse(res, 'Could not remove bank account', 500);
  }
};

// ============================================
// GET NIGERIAN BANKS
// ============================================
const getNigerianBanks = async (req, res) => {
  const { getNigerianBanks: fetchBanks } = require('../services/flutterwave');
  try {
    const result = await fetchBanks();
    return successResponse(res, { banks: result.banks });
  } catch (err) {
    return errorResponse(res, 'Could not fetch banks', 500);
  }
};

module.exports = {
  getBalances,
  getTransactions,
  getTransaction,
  exchangeRate,
  getBankAccounts,
  addBankAccount,
  deleteBankAccount,
  getNigerianBanks,
};
