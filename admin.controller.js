// src/controllers/admin.controller.js
const { query } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPagination } = require('../utils/helpers');

// ============================================
// DASHBOARD STATS
// ============================================
const getDashboardStats = async (req, res) => {
  try {
    const [users, transactions, kyc, volume] = await Promise.all([
      query(`SELECT COUNT(*) as total,
               SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
               SUM(CASE WHEN created_at > NOW()-INTERVAL '7 days' THEN 1 ELSE 0 END) as new_this_week
             FROM users WHERE role='user'`),
      query(`SELECT COUNT(*) as total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
               SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) as pending,
               SUM(CASE WHEN flagged=TRUE THEN 1 ELSE 0 END) as flagged
             FROM transactions`),
      query(`SELECT COUNT(*) as total,
               SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
               SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved
             FROM kyc_records`),
      query(`SELECT send_currency,
               SUM(send_amount) as total_volume,
               SUM(fee_amount) as total_fees
             FROM transactions WHERE status='completed'
             GROUP BY send_currency`),
    ]);

    return successResponse(res, {
      users: users.rows[0],
      transactions: transactions.rows[0],
      kyc: kyc.rows[0],
      volume: volume.rows,
    });
  } catch (err) {
    return errorResponse(res, 'Could not fetch stats', 500);
  }
};

// ============================================
// LIST USERS
// ============================================
const listUsers = async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const { limit: lim, offset } = getPagination(page, limit);

  try {
    let where = `WHERE u.role = 'user'`;
    const params = [];
    let idx = 1;

    if (status) { where += ` AND u.status = $${idx++}`; params.push(status); }
    if (search) {
      where += ` AND (u.email ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.phone ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }

    const total = await query(`SELECT COUNT(*) FROM users u ${where}`, params);

    const result = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.country,
              u.phone_verified, u.email_verified, u.status, u.role,
              u.last_login_at, u.created_at,
              k.status as kyc_status
       FROM users u
       LEFT JOIN kyc_records k ON k.user_id = u.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, lim, offset]
    );

    return paginatedResponse(res, result.rows, {
      page: parseInt(page), limit: lim,
      total: parseInt(total.rows[0].count),
      totalPages: Math.ceil(parseInt(total.rows[0].count) / lim),
    });
  } catch (err) {
    return errorResponse(res, 'Could not fetch users', 500);
  }
};

// ============================================
// GET USER DETAIL
// ============================================
const getUserDetail = async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await query(
      `SELECT u.*, k.status as kyc_status, k.id_type, k.submitted_at as kyc_submitted_at
       FROM users u LEFT JOIN kyc_records k ON k.user_id = u.id
       WHERE u.id = $1`, [userId]
    );
    if (!user.rows[0]) return errorResponse(res, 'User not found', 404);

    const wallets = await query(`SELECT * FROM wallets WHERE user_id = $1`, [userId]);
    const recentTxns = await query(
      `SELECT * FROM transactions WHERE sender_id=$1 OR recipient_id=$1
       ORDER BY created_at DESC LIMIT 10`, [userId]
    );

    const { password_hash, ...safeUser } = user.rows[0];

    return successResponse(res, { user: safeUser, wallets: wallets.rows, recent_transactions: recentTxns.rows });
  } catch (err) {
    return errorResponse(res, 'Could not fetch user', 500);
  }
};

// ============================================
// SUSPEND / ACTIVATE USER
// ============================================
const updateUserStatus = async (req, res) => {
  const { userId } = req.params;
  const { status, reason } = req.body;

  if (!['active', 'suspended'].includes(status)) {
    return errorResponse(res, 'Status must be active or suspended', 400);
  }

  try {
    await query(`UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2`, [status, userId]);
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, resource_id, details)
       VALUES ($1,'user_status_change','users',$2,$3)`,
      [req.user.id, userId, JSON.stringify({ status, reason })]
    );
    return successResponse(res, {}, `User ${status}`);
  } catch (err) {
    return errorResponse(res, 'Could not update user status', 500);
  }
};

// ============================================
// LIST ALL TRANSACTIONS (Admin)
// ============================================
const listTransactions = async (req, res) => {
  const { page = 1, limit = 20, status, type, flagged } = req.query;
  const { limit: lim, offset } = getPagination(page, limit);

  try {
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;

    if (status) { where += ` AND t.status=$${idx++}`; params.push(status); }
    if (type)   { where += ` AND t.type=$${idx++}`; params.push(type); }
    if (flagged === 'true') { where += ` AND t.flagged=TRUE`; }

    const total = await query(`SELECT COUNT(*) FROM transactions t ${where}`, params);

    const result = await query(
      `SELECT t.*,
         s.email as sender_email, s.first_name||' '||s.last_name as sender_name,
         r.email as recipient_email
       FROM transactions t
       LEFT JOIN users s ON s.id=t.sender_id
       LEFT JOIN users r ON r.id=t.recipient_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, lim, offset]
    );

    return paginatedResponse(res, result.rows, {
      page: parseInt(page), limit: lim,
      total: parseInt(total.rows[0].count),
      totalPages: Math.ceil(parseInt(total.rows[0].count) / lim),
    });
  } catch (err) {
    return errorResponse(res, 'Could not fetch transactions', 500);
  }
};

// ============================================
// RESOLVE FLAGGED TRANSACTION
// ============================================
const resolveFlaggedTransaction = async (req, res) => {
  const { transactionId } = req.params;
  const { action } = req.body; // 'clear' or 'reverse'

  try {
    if (action === 'clear') {
      await query(`UPDATE transactions SET flagged=FALSE, flag_reason=NULL WHERE id=$1`, [transactionId]);
    } else if (action === 'reverse') {
      const txn = await query(`SELECT * FROM transactions WHERE id=$1`, [transactionId]);
      if (!txn.rows[0]) return errorResponse(res, 'Transaction not found', 404);
      const t = txn.rows[0];

      if (t.status === 'completed' && t.sender_id) {
        const { creditWallet } = require('../services/wallet');
        await creditWallet(t.sender_id, t.send_currency, parseFloat(t.send_amount) + parseFloat(t.fee_amount));
      }
      await query(`UPDATE transactions SET status='reversed', flagged=FALSE WHERE id=$1`, [transactionId]);
    }

    await query(
      `INSERT INTO audit_logs (user_id, action, resource, resource_id, details)
       VALUES ($1,'flag_resolve','transactions',$2,$3)`,
      [req.user.id, transactionId, JSON.stringify({ action })]
    );

    return successResponse(res, {}, `Transaction ${action}d`);
  } catch (err) {
    return errorResponse(res, 'Could not resolve transaction', 500);
  }
};

module.exports = {
  getDashboardStats, listUsers, getUserDetail,
  updateUserStatus, listTransactions, resolveFlaggedTransaction,
};
