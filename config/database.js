// src/config/database.js
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'naraflow_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ Database connected');
  }
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('SQL', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('DB Query Error:', err.message, '\nQuery:', text);
    throw err;
  }
};

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
