// src/utils/otp.js
const crypto = require('crypto');
const { query } = require('../config/database');

const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

const createOTP = async (userId, type) => {
  const otp = generateOTP(parseInt(process.env.OTP_LENGTH) || 6);
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  // Invalidate previous OTPs of same type
  await query(
    `UPDATE otp_tokens SET used = TRUE WHERE user_id = $1 AND type = $2 AND used = FALSE`,
    [userId, type]
  );

  await query(
    `INSERT INTO otp_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, otp, type, expiresAt]
  );

  return otp;
};

const verifyOTP = async (userId, token, type) => {
  const result = await query(
    `SELECT * FROM otp_tokens 
     WHERE user_id = $1 AND token = $2 AND type = $3 
     AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, token, type]
  );

  if (result.rows.length === 0) {
    return { valid: false, message: 'Invalid or expired OTP' };
  }

  // Mark as used
  await query(`UPDATE otp_tokens SET used = TRUE WHERE id = $1`, [result.rows[0].id]);

  return { valid: true };
};

module.exports = { generateOTP, createOTP, verifyOTP };
