// src/controllers/kyc.controller.js
const { query } = require('../config/database');
const { notifyKYCStatus } = require('../services/notification');
const { successResponse, errorResponse } = require('../utils/helpers');
const path = require('path');
const fs = require('fs');

// ============================================
// SUBMIT KYC
// ============================================
const submitKYC = async (req, res) => {
  const { id_type, id_number } = req.body;
  const userId = req.user.id;

  try {
    const existing = await query(
      `SELECT status FROM kyc_records WHERE user_id = $1`, [userId]
    );

    if (existing.rows[0]?.status === 'approved') {
      return errorResponse(res, 'Your KYC is already approved.', 409);
    }
    if (existing.rows[0]?.status === 'under_review') {
      return errorResponse(res, 'Your KYC is currently under review.', 409);
    }

    const idDocUrl = req.files?.id_document?.[0]?.path || null;
    const selfieUrl = req.files?.selfie?.[0]?.path || null;

    if (!idDocUrl) return errorResponse(res, 'ID document is required.', 400);

    const result = await query(
      `INSERT INTO kyc_records (user_id, id_type, id_number, id_document_url, selfie_url, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET
         id_type = $2, id_number = $3,
         id_document_url = COALESCE($4, kyc_records.id_document_url),
         selfie_url = COALESCE($5, kyc_records.selfie_url),
         status = 'pending', rejection_reason = NULL,
         submitted_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [userId, id_type, id_number, idDocUrl, selfieUrl]
    );

    return successResponse(res, { kyc: result.rows[0] }, 'KYC submitted for review', 201);
  } catch (err) {
    console.error('KYC submit error:', err);
    return errorResponse(res, 'KYC submission failed', 500);
  }
};

// ============================================
// GET KYC STATUS
// ============================================
const getKYCStatus = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, id_type, id_number, status, rejection_reason, submitted_at, reviewed_at
       FROM kyc_records WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return successResponse(res, { kyc: null, status: 'not_submitted' });
    }

    return successResponse(res, { kyc: result.rows[0], status: result.rows[0].status });
  } catch (err) {
    return errorResponse(res, 'Could not fetch KYC status', 500);
  }
};

// ============================================
// ADMIN: LIST ALL KYC (pending/all)
// ============================================
const listKYC = async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const result = await query(
      `SELECT k.*, u.email, u.first_name, u.last_name, u.phone, u.country
       FROM kyc_records k
       JOIN users u ON u.id = k.user_id
       WHERE ($1 = 'all' OR k.status = $1)
       ORDER BY k.submitted_at ASC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit), offset]
    );

    const count = await query(
      `SELECT COUNT(*) FROM kyc_records WHERE ($1 = 'all' OR status = $1)`,
      [status]
    );

    return successResponse(res, {
      records: result.rows,
      total: parseInt(count.rows[0].count),
    });
  } catch (err) {
    return errorResponse(res, 'Could not fetch KYC records', 500);
  }
};

// ============================================
// ADMIN: APPROVE / REJECT KYC
// ============================================
const reviewKYC = async (req, res) => {
  const { userId } = req.params;
  const { action, rejection_reason } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return errorResponse(res, 'Action must be approve or reject', 400);
  }
  if (action === 'reject' && !rejection_reason) {
    return errorResponse(res, 'Rejection reason required', 400);
  }

  try {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const result = await query(
      `UPDATE kyc_records SET
         status = $1, rejection_reason = $2,
         reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE user_id = $4 RETURNING *`,
      [newStatus, rejection_reason || null, req.user.id, userId]
    );

    if (result.rows.length === 0) return errorResponse(res, 'KYC record not found', 404);

    notifyKYCStatus(userId, newStatus);

    return successResponse(res, { kyc: result.rows[0] }, `KYC ${newStatus}`);
  } catch (err) {
    return errorResponse(res, 'KYC review failed', 500);
  }
};

module.exports = { submitKYC, getKYCStatus, listKYC, reviewKYC };
