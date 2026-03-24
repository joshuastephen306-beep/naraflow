// src/utils/email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const emailTemplates = {
  welcome: (firstName) => ({
    subject: `Welcome to NaraFlow, ${firstName}! 🎉`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0E1A; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #00D4AA 0%, #007AFF 100%); padding: 40px 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 32px; font-weight: 800; letter-spacing: -1px;">NaraFlow</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Send money home, effortlessly.</p>
        </div>
        <div style="padding: 40px 30px;">
          <h2 style="color: #00D4AA; margin-top: 0;">Welcome aboard, ${firstName}!</h2>
          <p style="color: #B0B8CC; line-height: 1.7;">Your NaraFlow account has been created. You can now send and receive money internationally with the best exchange rates.</p>
          <p style="color: #B0B8CC; line-height: 1.7;">To get started, complete your KYC verification to unlock all features.</p>
          <a href="${process.env.FRONTEND_URL}/kyc" style="display: inline-block; background: linear-gradient(135deg, #00D4AA, #007AFF); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Complete Verification →</a>
        </div>
        <div style="padding: 20px 30px; border-top: 1px solid #1E2435; text-align: center;">
          <p style="color: #5A6475; font-size: 12px; margin: 0;">© 2024 NaraFlow. All rights reserved.</p>
        </div>
      </div>
    `,
  }),

  otpVerification: (firstName, otp, type) => ({
    subject: `Your NaraFlow Verification Code: ${otp}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0E1A; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #00D4AA 0%, #007AFF 100%); padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">NaraFlow</h1>
        </div>
        <div style="padding: 40px 30px; text-align: center;">
          <h2 style="color: #fff; margin-top: 0;">Verification Code</h2>
          <p style="color: #B0B8CC;">Hi ${firstName}, use this code to ${type}:</p>
          <div style="background: #1E2435; border: 2px solid #00D4AA; border-radius: 12px; padding: 24px; margin: 24px 0; display: inline-block; min-width: 200px;">
            <span style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #00D4AA;">${otp}</span>
          </div>
          <p style="color: #5A6475; font-size: 13px;">This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share it with anyone.</p>
        </div>
      </div>
    `,
  }),

  transactionSuccess: (firstName, amount, currency, reference, type) => ({
    subject: `Transaction ${type === 'send' ? 'Sent' : 'Received'}: ${currency} ${amount}`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0E1A; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #00D4AA 0%, #007AFF 100%); padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">NaraFlow</h1>
        </div>
        <div style="padding: 40px 30px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <div style="background: #00D4AA20; border-radius: 50%; width: 64px; height: 64px; display: inline-flex; align-items: center; justify-content: center; font-size: 32px;">✅</div>
          </div>
          <h2 style="color: #00D4AA; text-align: center;">Transaction Successful!</h2>
          <p style="color: #B0B8CC;">Hi ${firstName}, your transaction has been processed.</p>
          <div style="background: #1E2435; border-radius: 10px; padding: 20px; margin-top: 20px;">
            <table style="width: 100%; color: #B0B8CC;">
              <tr><td>Amount</td><td style="text-align:right; color: #fff; font-weight: 700;">${currency} ${amount}</td></tr>
              <tr><td style="padding-top:12px;">Reference</td><td style="text-align:right; color: #007AFF; padding-top:12px;">${reference}</td></tr>
              <tr><td style="padding-top:12px;">Status</td><td style="text-align:right; color: #00D4AA; padding-top:12px;">Completed ✓</td></tr>
            </table>
          </div>
        </div>
      </div>
    `,
  }),

  passwordReset: (firstName, otp) => ({
    subject: `NaraFlow Password Reset Code`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0E1A; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #00D4AA 0%, #007AFF 100%); padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 800;">NaraFlow</h1>
        </div>
        <div style="padding: 40px 30px; text-align: center;">
          <h2 style="color: #fff;">Password Reset</h2>
          <p style="color: #B0B8CC;">Hi ${firstName}, here is your password reset code:</p>
          <div style="background: #1E2435; border: 2px solid #FF6B6B; border-radius: 12px; padding: 24px; margin: 24px 0;">
            <span style="font-size: 40px; font-weight: 800; letter-spacing: 8px; color: #FF6B6B;">${otp}</span>
          </div>
          <p style="color: #5A6475; font-size: 13px;">If you didn't request this, please ignore this email. Code expires in 10 minutes.</p>
        </div>
      </div>
    `,
  }),
};

const sendEmail = async ({ to, subject, html }) => {
  try {
    if (process.env.NODE_ENV === 'test') {
      console.log(`[TEST] Email to ${to}: ${subject}`);
      return true;
    }
    
    const result = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'NaraFlow <noreply@naraflow.com>',
      to,
      subject,
      html,
    });
    return result;
  } catch (err) {
    console.error('Email send error:', err.message);
    return null;
  }
};

const sendWelcomeEmail = (email, firstName) => {
  const { subject, html } = emailTemplates.welcome(firstName);
  return sendEmail({ to: email, subject, html });
};

const sendOTPEmail = (email, firstName, otp, type = 'verify your account') => {
  const { subject, html } = emailTemplates.otpVerification(firstName, otp, type);
  return sendEmail({ to: email, subject, html });
};

const sendTransactionEmail = (email, firstName, amount, currency, reference, type) => {
  const { subject, html } = emailTemplates.transactionSuccess(firstName, amount, currency, reference, type);
  return sendEmail({ to: email, subject, html });
};

const sendPasswordResetEmail = (email, firstName, otp) => {
  const { subject, html } = emailTemplates.passwordReset(firstName, otp);
  return sendEmail({ to: email, subject, html });
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendOTPEmail,
  sendTransactionEmail,
  sendPasswordResetEmail,
};
