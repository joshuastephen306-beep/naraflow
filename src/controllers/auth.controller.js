// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateTokenPair, verifyRefreshToken, revokeRefreshToken } = require('../utils/jwt');
const { createOTP, verifyOTP } = require('../utils/otp');
const { sendWelcomeEmail, sendOTPEmail, sendPasswordResetEmail } = require('../utils/email');
const { createUserWallets } = require('../services/wallet');
const { successResponse, errorResponse, sanitizeUser } = require('../utils/helpers');

// ============================================
// REGISTER
// ============================================
const register = async (req, res) => {
  const { email, password, first_name, last_name, phone, country } = req.body;
  
  try {
    // Check if email exists
    const emailCheck = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return errorResponse(res, 'An account with this email already exists.', 409);
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Create user
    const userResult = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, country, currency_preference)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, first_name, last_name, phone, country, role, status, created_at`,
      [
        email,
        password_hash,
        first_name.trim(),
        last_name.trim(),
        phone || null,
        country.toUpperCase(),
        country.toUpperCase() === 'NG' ? 'NGN' : 'USD',
      ]
    );

    const user = userResult.rows[0];

    // Create wallets for the new user
    await createUserWallets(user.id);

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokenPair(user);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, first_name).catch(console.error);

    // Send OTP for email verification
    const otp = await createOTP(user.id, 'email_verify');
    sendOTPEmail(email, first_name, otp, 'verify your email').catch(console.error);

    return successResponse(res, {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
      message: 'Account created! Please verify your email.',
    }, 'Registration successful', 201);
  } catch (err) {
    console.error('Register error:', err);
    return errorResponse(res, 'Registration failed. Please try again.', 500);
  }
};

// ============================================
// LOGIN
// ============================================
const login = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await query(
      `SELECT id, email, password_hash, first_name, last_name, phone, phone_verified,
              email_verified, country, currency_preference, role, status, avatar_url
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    const user = result.rows[0];

    if (user.status === 'suspended') {
      return errorResponse(res, 'Your account has been suspended. Contact support@naraflow.com', 403);
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    // Update last login
    query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { accessToken, refreshToken } = await generateTokenPair(user);

    return successResponse(res, {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    }, 'Login successful');
  } catch (err) {
    console.error('Login error:', err);
    return errorResponse(res, 'Login failed. Please try again.', 500);
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  
  if (!token) return errorResponse(res, 'Refresh token required', 400);

  const decoded = verifyRefreshToken(token);
  if (!decoded) return errorResponse(res, 'Invalid or expired refresh token', 401);

  try {
    // Check if token exists and isn't revoked
    const tokenResult = await query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()`,
      [token]
    );
    
    if (tokenResult.rows.length === 0) {
      return errorResponse(res, 'Token is revoked or expired', 401);
    }

    const userResult = await query(
      `SELECT id, email, first_name, last_name, role, status FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (!userResult.rows[0]) return errorResponse(res, 'User not found', 401);

    const user = userResult.rows[0];

    // Revoke old token and issue new pair
    await revokeRefreshToken(token);
    const newTokens = await generateTokenPair(user);

    return successResponse(res, newTokens, 'Tokens refreshed');
  } catch (err) {
    return errorResponse(res, 'Token refresh failed', 500);
  }
};

// ============================================
// LOGOUT
// ============================================
const logout = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (token) await revokeRefreshToken(token).catch(() => {});
  return successResponse(res, {}, 'Logged out successfully');
};

// ============================================
// VERIFY EMAIL OTP
// ============================================
const verifyEmail = async (req, res) => {
  const { otp } = req.body;
  const userId = req.user.id;
  
  const result = await verifyOTP(userId, otp, 'email_verify');
  
  if (!result.valid) {
    return errorResponse(res, result.message, 400);
  }
  
  await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
  return successResponse(res, {}, 'Email verified successfully');
};

// ============================================
// SEND PHONE OTP
// ============================================
const sendPhoneOTP = async (req, res) => {
  const userId = req.user.id;
  const { phone } = req.body;
  
  try {
    if (phone) {
      await query('UPDATE users SET phone = $1 WHERE id = $2', [phone, userId]);
    }
    
    const otp = await createOTP(userId, 'phone_verify');
    
    // In production: Use Twilio, Africa's Talking, or Termii for SMS
    // For development, return OTP in response
    const responseData = {};
    if (process.env.NODE_ENV !== 'production') {
      responseData.dev_otp = otp; // Remove in production!
    }
    
    console.log(`[SMS OTP] User ${userId}: ${otp}`); // Log for testing
    
    return successResponse(res, responseData, 'OTP sent to your phone number');
  } catch (err) {
    return errorResponse(res, 'Could not send OTP', 500);
  }
};

// ============================================
// VERIFY PHONE OTP
// ============================================
const verifyPhone = async (req, res) => {
  const { otp } = req.body;
  const userId = req.user.id;
  
  const result = await verifyOTP(userId, otp, 'phone_verify');
  if (!result.valid) return errorResponse(res, result.message, 400);
  
  await query('UPDATE users SET phone_verified = TRUE WHERE id = $1', [userId]);
  return successResponse(res, {}, 'Phone number verified successfully');
};

// ============================================
// FORGOT PASSWORD
// ============================================
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  
  try {
    const result = await query(
      'SELECT id, first_name, email FROM users WHERE email = $1',
      [email]
    );

    // Don't reveal if email exists
    if (result.rows.length === 0) {
      return successResponse(res, {}, 'If that email exists, a reset code has been sent.');
    }

    const user = result.rows[0];
    const otp = await createOTP(user.id, 'password_reset');
    
    sendPasswordResetEmail(user.email, user.first_name, otp).catch(console.error);
    
    const responseData = {};
    if (process.env.NODE_ENV !== 'production') {
      responseData.dev_otp = otp;
    }

    return successResponse(res, responseData, 'If that email exists, a reset code has been sent.');
  } catch (err) {
    return errorResponse(res, 'Password reset failed', 500);
  }
};

// ============================================
// RESET PASSWORD
// ============================================
const resetPassword = async (req, res) => {
  const { email, otp, new_password } = req.body;
  
  try {
    const userResult = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) return errorResponse(res, 'Invalid request', 400);
    
    const userId = userResult.rows[0].id;
    const verification = await verifyOTP(userId, otp, 'password_reset');
    
    if (!verification.valid) return errorResponse(res, verification.message, 400);
    
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(new_password, salt);
    
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, userId]);
    
    // Revoke all refresh tokens for security
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [userId]);
    
    return successResponse(res, {}, 'Password reset successful. Please login.');
  } catch (err) {
    return errorResponse(res, 'Password reset failed', 500);
  }
};

// ============================================
// GET PROFILE
// ============================================
const getProfile = async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.phone_verified, 
              u.email_verified, u.country, u.currency_preference, u.role, u.status, 
              u.avatar_url, u.last_login_at, u.created_at,
              k.status as kyc_status, k.id_type as kyc_id_type
       FROM users u
       LEFT JOIN kyc_records k ON k.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    
    return successResponse(res, { user: result.rows[0] });
  } catch (err) {
    return errorResponse(res, 'Could not fetch profile', 500);
  }
};

// ============================================
// UPDATE PROFILE
// ============================================
const updateProfile = async (req, res) => {
  const { first_name, last_name, currency_preference } = req.body;
  
  try {
    const result = await query(
      `UPDATE users SET 
         first_name = COALESCE($1, first_name),
         last_name = COALESCE($2, last_name),
         currency_preference = COALESCE($3, currency_preference),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, first_name, last_name, phone, country, currency_preference, role`,
      [first_name, last_name, currency_preference, req.user.id]
    );
    
    return successResponse(res, { user: result.rows[0] }, 'Profile updated');
  } catch (err) {
    return errorResponse(res, 'Profile update failed', 500);
  }
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  verifyEmail,
  sendPhoneOTP,
  verifyPhone,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
};
