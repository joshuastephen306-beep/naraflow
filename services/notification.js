// src/services/notification.js
const { query } = require('../config/database');

const createNotification = async ({ userId, title, body, type = 'info', data = null }) => {
  try {
    const result = await query(
      `INSERT INTO notifications (user_id, title, body, type, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, body, type, data ? JSON.stringify(data) : null]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Notification create error:', err.message);
    return null;
  }
};

const getUserNotifications = async (userId, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  
  const result = await query(
    `SELECT * FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  
  const unreadCount = await query(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE`,
    [userId]
  );
  
  return {
    notifications: result.rows,
    unreadCount: parseInt(unreadCount.rows[0].count),
  };
};

const markAsRead = async (userId, notificationId) => {
  await query(
    `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
};

const markAllAsRead = async (userId) => {
  await query(
    `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
    [userId]
  );
};

// Transaction notifications
const notifyTransactionSent = (userId, amount, currency, recipient) =>
  createNotification({
    userId,
    title: 'Money Sent ✓',
    body: `You sent ${currency} ${amount} to ${recipient}. Transaction is being processed.`,
    type: 'transaction',
    data: { amount, currency, recipient },
  });

const notifyTransactionReceived = (userId, amount, currency, sender) =>
  createNotification({
    userId,
    title: 'Money Received 🎉',
    body: `You received ${currency} ${amount}${sender ? ` from ${sender}` : ''}!`,
    type: 'success',
    data: { amount, currency, sender },
  });

const notifyWithdrawal = (userId, amount, currency, bankName) =>
  createNotification({
    userId,
    title: 'Withdrawal Initiated',
    body: `Withdrawal of ${currency} ${amount} to ${bankName} is being processed.`,
    type: 'info',
    data: { amount, currency, bankName },
  });

const notifyKYCStatus = (userId, status) =>
  createNotification({
    userId,
    title: `KYC ${status === 'approved' ? 'Approved ✓' : 'Update'}`,
    body: status === 'approved'
      ? 'Your identity verification has been approved. You can now send and receive money without limits!'
      : `Your KYC verification status: ${status}. Please check your profile for details.`,
    type: status === 'approved' ? 'success' : 'warning',
    data: { status },
  });

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  notifyTransactionSent,
  notifyTransactionReceived,
  notifyWithdrawal,
  notifyKYCStatus,
};
