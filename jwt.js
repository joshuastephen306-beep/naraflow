// src/utils/jwt.js
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');

const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'naraflow',
    audience: 'naraflow-users',
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: 'naraflow',
  });
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'naraflow',
      audience: 'naraflow-users',
    });
  } catch (err) {
    return null;
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'naraflow',
    });
  } catch (err) {
    return null;
  }
};

const storeRefreshToken = async (userId, token) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  
  await query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
};

const revokeRefreshToken = async (token) => {
  await query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1`, [token]);
};

const generateTokenPair = async (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    jti: uuidv4(),
  };
  
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken({ sub: user.id, jti: uuidv4() });
  
  await storeRefreshToken(user.id, refreshToken);
  
  return { accessToken, refreshToken };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  storeRefreshToken,
  revokeRefreshToken,
  generateTokenPair,
};
