// src/controllers/payment.controller.js
const { query, getClient } = require('../config/database');
const { debitWallet, creditWallet, getWallet, walletToWalletTransfer } = require('../services/wallet');
const { initiateBankTransfer, createPaymentLink, verifyTransaction: flwVerify, resolveBankAccount } = require('../services/flutterwave');
const { initializeTransaction: psInitialize, verifyTransaction: psVerify } = require('../services/paystack');
const { notifyTransactionSent, notifyTransactionReceived, notifyWithdrawal } = require('../services/notification');
const { sendTransactionEmail } = require('../utils/email');
const { generateReference, calculateFee, isFraudulent, successResponse, errorResponse } = require('../utils/helpers');

// ============================================
// SEND MONEY
// ============================================
const sendMoney = async (req, res) => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    const {
      amount,
      send_currency,
      receive_currency,
      recipient_type, // 'bank' or 'wallet'
      recipient_email, // For wallet transfers
      recipient_account_number,
      recipient_bank_code,
      recipient_bank_name,
      recipient_name,
      narration,
    } = req.body;

    const sendAmount = parseFloat(amount);
    const fee = calculateFee(sendAmount, send_currency);
    const totalDebit = sendAmount + fee;

    // 1. Check sender wallet balance
    const senderWallet = await query(
      `SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [req.user.id, send_currency]
    );

    if (!senderWallet.rows[0] || parseFloat(senderWallet.rows[0].balance) < totalDebit) {
      await client.query('ROLLBACK');
      return errorResponse(res, `Insufficient ${send_currency} balance. You need ${totalDebit} but have ${senderWallet.rows[0]?.balance || 0}`, 400);
    }

    // 2. Fraud check
    const recentTxns = await query(
      `SELECT * FROM transactions WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.user.id]
    );
    const fraudCheck = isFraudulent(req.body, recentTxns.rows);

    // 3. Generate reference
    const reference = generateReference('NF-SEND');

    let receiveAmount = sendAmount;
    let exchangeRate = 1;

    // 4. Calculate exchange rate if currencies differ
    if (send_currency !== receive_currency) {
      const rateResult = await query(
        `SELECT rate FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2`,
        [send_currency, receive_currency]
      );
      
      if (rateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse(res, 'Exchange rate not available. Please try again.', 503);
      }
      
      exchangeRate = parseFloat(rateResult.rows[0].rate);
      receiveAmount = parseFloat((sendAmount * exchangeRate).toFixed(2));
    }

    // 5. Create transaction record
    let recipientId = null;
    if (recipient_type === 'wallet' && recipient_email) {
      const recipientUser = await query(
        `SELECT id FROM users WHERE email = $1`,
        [recipient_email]
      );
      if (recipientUser.rows[0]) recipientId = recipientUser.rows[0].id;
    }

    const txnResult = await client.query(
      `INSERT INTO transactions (
         reference, sender_id, recipient_id, type,
         send_amount, send_currency, receive_amount, receive_currency,
         exchange_rate, fee_amount, fee_currency,
         recipient_account_number, recipient_bank_name, recipient_bank_code,
         recipient_name, recipient_email, narration,
         status, provider, flagged, flag_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        reference, req.user.id, recipientId,
        recipient_type === 'wallet' ? 'wallet_transfer' : 'send_money',
        sendAmount, send_currency, receiveAmount, receive_currency,
        exchangeRate, fee, send_currency,
        recipient_account_number || null,
        recipient_bank_name || null,
        recipient_bank_code || null,
        recipient_name || null,
        recipient_email || null,
        narration || 'Transfer',
        'processing',
        recipient_type === 'wallet' ? 'internal' : 'flutterwave',
        fraudCheck.flagged,
        fraudCheck.reasons.join(', ') || null,
      ]
    );

    // 6. Debit sender wallet
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2 AND currency = $3 AND balance >= $1`,
      [totalDebit, req.user.id, send_currency]
    );

    await client.query('COMMIT');

    // 7. Process transfer (async)
    const transaction = txnResult.rows[0];
    
    processTransfer({
      transaction,
      recipientType: recipient_type,
      recipientId,
      receiveAmount,
      receive_currency,
      recipient_account_number,
      recipient_bank_code,
      recipient_name,
      narration,
      reference,
      senderUser: req.user,
    }).catch(console.error);

    return successResponse(res, {
      transaction: {
        id: transaction.id,
        reference: transaction.reference,
        send_amount: sendAmount,
        send_currency,
        receive_amount: receiveAmount,
        receive_currency,
        fee_amount: fee,
        exchange_rate: exchangeRate,
        status: 'processing',
      },
      message: 'Transfer initiated successfully. Processing...',
    }, 'Transfer initiated', 201);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Send money error:', err);
    return errorResponse(res, err.message || 'Transfer failed. Please try again.', 500);
  } finally {
    client.release();
  }
};

// ============================================
// PROCESS TRANSFER (Background)
// ============================================
const processTransfer = async ({
  transaction, recipientType, recipientId,
  receiveAmount, receive_currency,
  recipient_account_number, recipient_bank_code,
  recipient_name, narration, reference, senderUser
}) => {
  try {
    if (recipientType === 'wallet' && recipientId) {
      // Internal wallet transfer
      await creditWallet(recipientId, receive_currency, receiveAmount);
      
      await query(
        `UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE reference = $1`,
        [reference]
      );
      
      // Notify both parties
      notifyTransactionSent(senderUser.id, receiveAmount, receive_currency, recipient_name || 'recipient');
      notifyTransactionReceived(recipientId, receiveAmount, receive_currency, `${senderUser.first_name} ${senderUser.last_name}`);
      sendTransactionEmail(senderUser.email, senderUser.first_name, receiveAmount, receive_currency, reference, 'send');

    } else {
      // Bank transfer via Flutterwave
      const transferResult = await initiateBankTransfer({
        amount: receiveAmount,
        currency: receive_currency,
        bankCode: recipient_bank_code,
        accountNumber: recipient_account_number,
        accountName: recipient_name,
        narration: narration || `NaraFlow: ${reference}`,
        reference,
      });

      if (transferResult.success) {
        await query(
          `UPDATE transactions SET 
             status = 'processing', 
             external_reference = $2, 
             provider_status = $3,
             provider_response = $4
           WHERE reference = $1`,
          [reference, transferResult.transferId?.toString(), transferResult.status, JSON.stringify(transferResult.raw)]
        );
        
        notifyTransactionSent(senderUser.id, receiveAmount, receive_currency, recipient_name);
        sendTransactionEmail(senderUser.email, senderUser.first_name, receiveAmount, receive_currency, reference, 'send');
      } else {
        // Refund sender
        await creditWallet(senderUser.id, transaction.send_currency, parseFloat(transaction.send_amount) + parseFloat(transaction.fee_amount));
        
        await query(
          `UPDATE transactions SET status = 'failed', provider_response = $2 WHERE reference = $1`,
          [reference, JSON.stringify({ error: transferResult.error })]
        );
      }
    }
  } catch (err) {
    console.error('Process transfer error:', err);
    // Attempt refund on error
    try {
      await creditWallet(
        transaction.sender_id,
        transaction.send_currency,
        parseFloat(transaction.send_amount) + parseFloat(transaction.fee_amount)
      );
      await query(`UPDATE transactions SET status = 'failed' WHERE reference = $1`, [transaction.reference]);
    } catch (refundErr) {
      console.error('CRITICAL: Refund failed for', transaction.reference, refundErr);
    }
  }
};

// ============================================
// RECEIVE MONEY (Create Payment Link)
// ============================================
const receiveMoney = async (req, res) => {
  const { amount, currency, description } = req.body;
  
  if (!amount || parseFloat(amount) <= 0) {
    return errorResponse(res, 'Valid amount required', 400);
  }
  
  try {
    const reference = generateReference('NF-RCV');
    
    // Create payment record
    await query(
      `INSERT INTO transactions (
         reference, recipient_id, type, receive_amount, receive_currency,
         status, provider, narration
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [reference, req.user.id, 'receive_money', parseFloat(amount), currency || 'NGN', 'pending', 'flutterwave', description || 'Request for payment']
    );
    
    const paymentLink = await createPaymentLink({
      amount: parseFloat(amount),
      currency: currency || 'NGN',
      email: req.user.email,
      name: `${req.user.first_name} ${req.user.last_name}`,
      reference,
      redirectUrl: `${process.env.FRONTEND_URL}/payment/callback?ref=${reference}`,
    });
    
    if (!paymentLink.success) {
      return errorResponse(res, 'Could not create payment link', 503);
    }
    
    return successResponse(res, {
      payment_link: paymentLink.paymentLink,
      reference,
      amount: parseFloat(amount),
      currency: currency || 'NGN',
    }, 'Payment link created');
  } catch (err) {
    return errorResponse(res, 'Could not create payment request', 500);
  }
};

// ============================================
// WITHDRAW MONEY (Wallet → Bank Account)
// ============================================
const withdrawMoney = async (req, res) => {
  const { amount, bank_account_id, narration } = req.body;
  const withdrawAmount = parseFloat(amount);
  
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Get bank account
    const bankResult = await query(
      `SELECT * FROM bank_accounts WHERE id = $1 AND user_id = $2`,
      [bank_account_id, req.user.id]
    );
    
    if (bankResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return errorResponse(res, 'Bank account not found', 404);
    }
    
    const bankAccount = bankResult.rows[0];
    const currency = bankAccount.currency || 'NGN';
    
    // Check wallet balance
    const walletResult = await client.query(
      `SELECT * FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
      [req.user.id, currency]
    );
    
    if (!walletResult.rows[0] || parseFloat(walletResult.rows[0].balance) < withdrawAmount) {
      await client.query('ROLLBACK');
      return errorResponse(res, 'Insufficient balance for withdrawal', 400);
    }
    
    const fee = calculateFee(withdrawAmount, currency);
    const totalDebit = withdrawAmount + fee;
    
    if (parseFloat(walletResult.rows[0].balance) < totalDebit) {
      await client.query('ROLLBACK');
      return errorResponse(res, `Insufficient balance. Need ${totalDebit} ${currency} (including ${fee} fee)`, 400);
    }
    
    const reference = generateReference('NF-WDW');
    
    // Create transaction
    const txnResult = await client.query(
      `INSERT INTO transactions (
         reference, sender_id, type, send_amount, send_currency,
         fee_amount, fee_currency, recipient_bank_id,
         recipient_account_number, recipient_account_name,
         recipient_bank_name, recipient_bank_code,
         narration, status, provider
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        reference, req.user.id, 'withdrawal', withdrawAmount, currency,
        fee, currency, bank_account_id,
        bankAccount.account_number, bankAccount.account_name,
        bankAccount.bank_name, bankAccount.bank_code,
        narration || 'Withdrawal to bank',
        'processing', 'flutterwave',
      ]
    );
    
    // Debit wallet
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2 AND currency = $3`,
      [totalDebit, req.user.id, currency]
    );
    
    await client.query('COMMIT');
    
    // Initiate bank transfer (async)
    const transaction = txnResult.rows[0];
    
    initiateBankTransfer({
      amount: withdrawAmount,
      currency,
      bankCode: bankAccount.bank_code,
      accountNumber: bankAccount.account_number,
      accountName: bankAccount.account_name,
      narration: narration || `NaraFlow Withdrawal: ${reference}`,
      reference,
    }).then(async (result) => {
      if (result.success) {
        await query(
          `UPDATE transactions SET external_reference = $2, provider_status = $3, provider_response = $4 
           WHERE reference = $1`,
          [reference, result.transferId?.toString(), result.status, JSON.stringify(result.raw)]
        );
        notifyWithdrawal(req.user.id, withdrawAmount, currency, bankAccount.bank_name);
      } else {
        // Refund
        await creditWallet(req.user.id, currency, totalDebit);
        await query(`UPDATE transactions SET status = 'failed' WHERE reference = $1`, [reference]);
      }
    }).catch(async (err) => {
      console.error('Withdrawal processing error:', err);
      await creditWallet(req.user.id, currency, totalDebit);
      await query(`UPDATE transactions SET status = 'failed' WHERE reference = $1`, [reference]);
    });
    
    return successResponse(res, {
      transaction: {
        reference,
        amount: withdrawAmount,
        fee,
        currency,
        bank_name: bankAccount.bank_name,
        account_number: bankAccount.account_number,
        status: 'processing',
      },
    }, 'Withdrawal initiated successfully');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Withdrawal error:', err);
    return errorResponse(res, 'Withdrawal failed. Please try again.', 500);
  } finally {
    client.release();
  }
};

// ============================================
// RESOLVE BANK ACCOUNT
// ============================================
const resolveBankAccountCtrl = async (req, res) => {
  const { account_number, bank_code } = req.query;
  
  if (!account_number || !bank_code) {
    return errorResponse(res, 'account_number and bank_code required', 400);
  }
  
  try {
    const result = await resolveBankAccount(account_number, bank_code);
    
    if (!result.success) {
      return errorResponse(res, 'Could not resolve account. Please check account number and bank.', 400);
    }
    
    return successResponse(res, {
      account_name: result.accountName,
      account_number: result.accountNumber,
      simulated: result.simulated || false,
    });
  } catch (err) {
    return errorResponse(res, 'Account resolution failed', 500);
  }
};

// ============================================
// CALCULATE SEND QUOTE
// ============================================
const getQuote = async (req, res) => {
  const { amount, send_currency, receive_currency } = req.query;
  
  if (!amount || !send_currency || !receive_currency) {
    return errorResponse(res, 'amount, send_currency, receive_currency required', 400);
  }
  
  try {
    const sendAmount = parseFloat(amount);
    const fee = calculateFee(sendAmount, send_currency);
    const totalDebit = sendAmount + fee;
    
    let receiveAmount = sendAmount;
    let rate = 1;
    
    if (send_currency !== receive_currency) {
      const rateResult = await query(
        `SELECT rate, fetched_at FROM exchange_rates 
         WHERE from_currency = $1 AND to_currency = $2`,
        [send_currency.toUpperCase(), receive_currency.toUpperCase()]
      );
      
      if (rateResult.rows.length > 0) {
        rate = parseFloat(rateResult.rows[0].rate);
        receiveAmount = parseFloat((sendAmount * rate).toFixed(2));
      }
    }
    
    return successResponse(res, {
      send_amount: sendAmount,
      send_currency: send_currency.toUpperCase(),
      receive_amount: receiveAmount,
      receive_currency: receive_currency.toUpperCase(),
      exchange_rate: rate,
      fee_amount: fee,
      fee_currency: send_currency.toUpperCase(),
      total_debit: totalDebit,
      estimated_arrival: '1-2 business days',
    });
  } catch (err) {
    return errorResponse(res, 'Could not calculate quote', 500);
  }
};

module.exports = {
  sendMoney,
  receiveMoney,
  withdrawMoney,
  resolveBankAccountCtrl,
  getQuote,
};
