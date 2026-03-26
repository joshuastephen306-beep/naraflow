// src/config/migrate.js
require('dotenv').config();
const { pool } = require('./database');

const schema = `
-- ============================================
-- NARAFLOW DATABASE SCHEMA
-- Full migration script
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE,
  phone_verified BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  country VARCHAR(3) NOT NULL DEFAULT 'NG',  -- ISO country code
  currency_preference VARCHAR(3) DEFAULT 'NGN',
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'support')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  avatar_url TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================
-- OTP / VERIFICATION TOKENS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS otp_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(10) NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('phone_verify', 'email_verify', 'password_reset', 'transaction_pin')),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_user_id ON otp_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_token ON otp_tokens(token);

-- ============================================
-- KYC RECORDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS kyc_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  id_type VARCHAR(30) CHECK (id_type IN ('passport', 'nin', 'drivers_license', 'bvn')),
  id_number VARCHAR(50),
  id_document_url TEXT,
  selfie_url TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'under_review')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_user_id ON kyc_records(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_records(status);

-- ============================================
-- WALLETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  currency VARCHAR(3) NOT NULL,  -- NGN, USD, GBP, EUR
  balance DECIMAL(18, 2) DEFAULT 0.00 NOT NULL,
  locked_balance DECIMAL(18, 2) DEFAULT 0.00 NOT NULL,  -- Pending transactions
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_currency ON wallets(currency);

-- ============================================
-- BANK ACCOUNTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  bank_name VARCHAR(100) NOT NULL,
  bank_code VARCHAR(10),           -- Nigerian bank codes
  account_number VARCHAR(20) NOT NULL,
  account_name VARCHAR(150) NOT NULL,
  country VARCHAR(3) DEFAULT 'NG',
  currency VARCHAR(3) DEFAULT 'NGN',
  is_default BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON bank_accounts(user_id);

-- ============================================
-- EXCHANGE RATES TABLE (Cache)
-- ============================================
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(18, 6) NOT NULL,
  provider VARCHAR(50) DEFAULT 'flutterwave',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_currency, to_currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(from_currency, to_currency);

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference VARCHAR(100) UNIQUE NOT NULL,   -- Internal reference
  external_reference VARCHAR(200),           -- Provider reference (Flutterwave/Paystack)
  
  sender_id UUID REFERENCES users(id),
  recipient_id UUID REFERENCES users(id),    -- Null for external bank transfers
  
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'wallet_transfer',  -- Wallet to wallet (internal)
    'send_money',       -- Wallet to external bank
    'receive_money',    -- External payment into wallet
    'withdrawal',       -- Wallet to linked bank
    'deposit',          -- Bank to wallet (funding)
    'fee'               -- Fee collection
  )),
  
  -- Amount fields
  send_amount DECIMAL(18, 2) NOT NULL,
  send_currency VARCHAR(3) NOT NULL,
  receive_amount DECIMAL(18, 2),
  receive_currency VARCHAR(3),
  exchange_rate DECIMAL(18, 6),
  
  -- Fees
  fee_amount DECIMAL(18, 2) DEFAULT 0.00,
  fee_currency VARCHAR(3),
  
  -- Recipient info (for external transfers)
  recipient_bank_id UUID REFERENCES bank_accounts(id),
  recipient_account_number VARCHAR(20),
  recipient_account_name VARCHAR(150),
  recipient_bank_name VARCHAR(100),
  recipient_bank_code VARCHAR(10),
  recipient_country VARCHAR(3),
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  recipient_name VARCHAR(200),
  
  -- Status tracking
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'
  )),
  
  -- Provider info
  provider VARCHAR(30) CHECK (provider IN ('flutterwave', 'paystack', 'internal')),
  provider_status VARCHAR(50),
  provider_response JSONB,
  
  -- Metadata
  description TEXT,
  narration TEXT,
  metadata JSONB,
  
  -- Fraud flags
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_txn_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_txn_sender ON transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_txn_recipient ON transactions(recipient_id);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_txn_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_external_ref ON transactions(external_reference);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error', 'transaction')),
  data JSONB,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);

-- ============================================
-- WEBHOOK LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(30) NOT NULL,
  event_type VARCHAR(100),
  payload JSONB NOT NULL,
  signature VARCHAR(500),
  processed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_provider ON webhook_logs(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_logs(processed);

-- ============================================
-- REFRESH TOKENS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(512) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100),
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ============================================
-- AUTO-UPDATE TIMESTAMP FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DO $$ BEGIN
  CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_kyc_updated_at BEFORE UPDATE ON kyc_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function migrate() {
  console.log('🚀 Running NaraFlow database migrations...');
  try {
    await pool.query(schema);
    console.log('✅ All migrations completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
