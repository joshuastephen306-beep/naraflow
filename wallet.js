// src/services/wallet.js
const { query, getClient } = require('../config/database');

const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'];

// ============================================
// CREATE WALLETS FOR NEW USER
// ============================================
const createUserWallets = async (userId) => {
  const promises = SUPPORTED_CURRENCIES.map(currency =>
    query(
      `INSERT INTO wallets (user_id, currency, balance) 
       VALUES ($1, $2, 0.00) 
       ON CONFLICT (user_id, currency) DO NOTHING`,
      [userId, currency]
    )
  );
  await Promise.all(promises);
};

// ============================================
// GET USER WALLETS
// ============================================
const getUserWallets = async (userId) => {
  const result = await query(
    `SELECT id, currency, balance, locked_balance, is_active, created_at
     FROM wallets WHERE user_id = $1 AND is_active = TRUE
     ORDER BY CASE currency WHEN 'NGN' THEN 1 WHEN 'USD' THEN 2 WHEN 'GBP' THEN 3 ELSE 4 END`,
    [userId]
  );
  return result.rows;
};

// ============================================
// GET SPECIFIC WALLET
// ============================================
const getWallet = async (userId, currency) => {
  const result = await query(
    `SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 AND is_active = TRUE`,
    [userId, currency]
  );
  return result.rows[0] || null;
};

// ============================================
// CREDIT WALLET (Add funds)
// ============================================
const creditWallet = async (userId, currency, amount, client = null) => {
  const db = client || { query: (text, params) => query(text, params) };
  
  const result = await db.query(
    `UPDATE wallets 
     SET balance = balance + $3, updated_at = NOW()
     WHERE user_id = $1 AND currency = $2 AND is_active = TRUE
     RETURNING *`,
    [userId, currency, parseFloat(amount)]
  );

  if (result.rows.length === 0) {
    throw new Error(`Wallet not found for user ${userId} in ${currency}`);
  }

  return result.rows[0];
};

// ============================================
// DEBIT WALLET (Remove funds - with balance check)
// ============================================
const debitWallet = async (userId, currency, amount, client = null) => {
  const db = client || { query: (text, params) => query(text, params) };
  
  // Lock the row and check balance atomically
  const result = await db.query(
    `UPDATE wallets 
     SET balance = balance - $3, updated_at = NOW()
     WHERE user_id = $1 AND currency = $2 AND is_active = TRUE 
     AND balance >= $3
     RETURNING *`,
    [userId, currency, parseFloat(amount)]
  );

  if (result.rows.length === 0) {
    throw new Error('Insufficient balance or wallet not found');
  }

  return result.rows[0];
};

// ============================================
// LOCK FUNDS (Pending transaction)
// ============================================
const lockFunds = async (userId, currency, amount, client = null) => {
  const db = client || { query: (text, params) => query(text, params) };
  
  const result = await db.query(
    `UPDATE wallets
     SET balance = balance - $3, locked_balance = locked_balance + $3, updated_at = NOW()
     WHERE user_id = $1 AND currency = $2 AND balance >= $3 AND is_active = TRUE
     RETURNING *`,
    [userId, currency, parseFloat(amount)]
  );

  if (result.rows.length === 0) {
    throw new Error('Insufficient balance or wallet not found');
  }

  return result.rows[0];
};

// ============================================
// UNLOCK FUNDS (Release locked)
// ============================================
const unlockFunds = async (userId, currency, amount, client = null) => {
  const db = client || { query: (text, params) => query(text, params) };
  
  await db.query(
    `UPDATE wallets
     SET locked_balance = GREATEST(locked_balance - $3, 0), 
         balance = balance + $3,
         updated_at = NOW()
     WHERE user_id = $1 AND currency = $2`,
    [userId, currency, parseFloat(amount)]
  );
};

// ============================================
// INTERNAL WALLET TRANSFER (Atomic)
// ============================================
const walletToWalletTransfer = async (senderId, recipientId, currency, amount) => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Debit sender
    const senderWallet = await client.query(
      `UPDATE wallets SET balance = balance - $3, updated_at = NOW()
       WHERE user_id = $1 AND currency = $2 AND balance >= $3 AND is_active = TRUE
       RETURNING *`,
      [senderId, currency, parseFloat(amount)]
    );
    
    if (senderWallet.rows.length === 0) {
      throw new Error('Insufficient balance');
    }
    
    // Credit recipient
    const recipientWallet = await client.query(
      `UPDATE wallets SET balance = balance + $3, updated_at = NOW()
       WHERE user_id = $1 AND currency = $2 AND is_active = TRUE
       RETURNING *`,
      [recipientId, currency, parseFloat(amount)]
    );
    
    if (recipientWallet.rows.length === 0) {
      throw new Error('Recipient wallet not found');
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      senderBalance: senderWallet.rows[0].balance,
      recipientBalance: recipientWallet.rows[0].balance,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  createUserWallets,
  getUserWallets,
  getWallet,
  creditWallet,
  debitWallet,
  lockFunds,
  unlockFunds,
  walletToWalletTransfer,
  SUPPORTED_CURRENCIES,
};
