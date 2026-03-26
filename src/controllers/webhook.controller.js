// src/controllers/webhook.controller.js
const crypto = require('crypto');
const { query } = require('../config/database');
const { creditWallet } = require('../services/wallet');
const { verifyWebhookSignature: flwVerify } = require('../services/flutterwave');
const { verifyWebhookSignature: psVerify } = require('../services/paystack');
const { notifyTransactionReceived } = require('../services/notification');
const { sendTransactionEmail } = require('../utils/email');

// ============================================
// FLUTTERWAVE WEBHOOK
// ============================================
const flutterwaveWebhook = async (req, res) => {
  const signature = req.headers['verif-hash'];

  // Always respond 200 first (webhook best practice)
  res.status(200).json({ status: 'received' });

  try {
    // Verify signature
    if (process.env.NODE_ENV === 'production') {
      const expectedHash = process.env.FLW_WEBHOOK_SECRET;
      if (signature !== expectedHash) {
        console.warn('Invalid FLW webhook signature');
        return;
      }
    }

    const payload = req.body;
    const event = payload.event;
    const data = payload.data;

    // Log webhook
    await query(
      `INSERT INTO webhook_logs (provider, event_type, payload, signature, processed)
       VALUES ('flutterwave', $1, $2, $3, FALSE)`,
      [event, JSON.stringify(payload), signature]
    );

    if (event === 'charge.completed' && data.status === 'successful') {
      await handleFlwPaymentReceived(data);
    } else if (event === 'transfer.completed') {
      await handleFlwTransferUpdate(data);
    }

    // Mark webhook as processed
    await query(
      `UPDATE webhook_logs SET processed=TRUE WHERE provider='flutterwave' AND event_type=$1
       AND (payload->>'data')::jsonb->>'id' = $2`,
      [event, data.id?.toString()]
    );
  } catch (err) {
    console.error('FLW webhook error:', err);
  }
};

// ============================================
// HANDLE INCOMING PAYMENT (Deposit/Receive)
// ============================================
const handleFlwPaymentReceived = async (data) => {
  const txRef = data.tx_ref; // Our reference
  const amount = data.amount;
  const currency = data.currency;

  const existing = await query(
    `SELECT * FROM transactions WHERE reference=$1`, [txRef]
  );

  if (!existing.rows[0]) {
    console.warn('Webhook: transaction not found for ref', txRef);
    return;
  }

  const txn = existing.rows[0];

  if (txn.status === 'completed') {
    console.log('Webhook: transaction already completed', txRef);
    return;
  }

  // Credit recipient wallet
  if (txn.recipient_id) {
    await creditWallet(txn.recipient_id, currency, amount);

    await query(
      `UPDATE transactions SET
         status='completed', completed_at=NOW(),
         external_reference=$2, provider_response=$3, updated_at=NOW()
       WHERE reference=$1`,
      [txRef, data.flw_ref, JSON.stringify(data)]
    );

    // Notify user
    notifyTransactionReceived(txn.recipient_id, amount, currency, null);

    // Get user email for notification
    const userResult = await query(
      `SELECT email, first_name FROM users WHERE id=$1`, [txn.recipient_id]
    );
    if (userResult.rows[0]) {
      sendTransactionEmail(
        userResult.rows[0].email,
        userResult.rows[0].first_name,
        amount, currency, txRef, 'receive'
      );
    }
  }
};

// ============================================
// HANDLE TRANSFER STATUS UPDATE (Withdrawal/Send)
// ============================================
const handleFlwTransferUpdate = async (data) => {
  const reference = data.reference;
  const status = data.status; // 'SUCCESSFUL', 'FAILED'

  const txn = await query(`SELECT * FROM transactions WHERE reference=$1`, [reference]);
  if (!txn.rows[0]) return;

  if (status === 'SUCCESSFUL') {
    await query(
      `UPDATE transactions SET status='completed', completed_at=NOW(), updated_at=NOW()
       WHERE reference=$1`, [reference]
    );
  } else if (status === 'FAILED') {
    const t = txn.rows[0];

    // Refund sender
    if (t.sender_id) {
      await creditWallet(t.sender_id, t.send_currency, parseFloat(t.send_amount) + parseFloat(t.fee_amount || 0));
    }

    await query(
      `UPDATE transactions SET status='failed', provider_response=$2, updated_at=NOW()
       WHERE reference=$1`,
      [reference, JSON.stringify(data)]
    );
  }
};

// ============================================
// PAYSTACK WEBHOOK
// ============================================
const paystackWebhook = async (req, res) => {
  res.status(200).json({ status: 'received' });

  try {
    const signature = req.headers['x-paystack-signature'];
    const payload = req.body;

    if (process.env.NODE_ENV === 'production') {
      const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(payload))
        .digest('hex');
      if (hash !== signature) {
        console.warn('Invalid Paystack webhook signature');
        return;
      }
    }

    await query(
      `INSERT INTO webhook_logs (provider, event_type, payload, signature, processed)
       VALUES ('paystack', $1, $2, $3, FALSE)`,
      [payload.event, JSON.stringify(payload), signature]
    );

    if (payload.event === 'charge.success') {
      const data = payload.data;
      // Same logic as FLW payment received
      await handleFlwPaymentReceived({
        tx_ref: data.reference,
        amount: data.amount / 100, // Paystack uses kobo
        currency: data.currency,
        flw_ref: data.id?.toString(),
        ...data,
      });
    } else if (payload.event === 'transfer.success') {
      await handleFlwTransferUpdate({
        reference: payload.data.reference,
        status: 'SUCCESSFUL',
      });
    } else if (payload.event === 'transfer.failed') {
      await handleFlwTransferUpdate({
        reference: payload.data.reference,
        status: 'FAILED',
      });
    }
  } catch (err) {
    console.error('Paystack webhook error:', err);
  }
};

module.exports = { flutterwaveWebhook, paystackWebhook };
