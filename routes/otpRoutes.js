const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const EmailOtp = require('../models/EmailOtp');
const { sendEmailOTP } = require('../services/emailService');

/**
 * @route   POST /api/otp/send-email-otp
 * @desc    Generate 6-digit OTP, save to DB with 5m expiry, send via Nodemailer
 * @access  Public
 */
router.post('/send-email-otp', async (req, res, next) => {
  try {
    const { email, purpose = 'Verification' } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email address is required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address format'
      });
    }

    // Generate random 6-digit numeric OTP
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Delete any existing active OTP for this email
    await EmailOtp.deleteMany({ email: cleanEmail });

    // Store new OTP in MongoDB Atlas
    await EmailOtp.create({
      email: cleanEmail,
      code: otpCode,
      purpose: purpose,
      expiresAt: expiresAt
    });

    // Send styled email via Nodemailer Gmail SMTP
    try {
      await sendEmailOTP(cleanEmail, otpCode, purpose);
    } catch (mailError) {
      console.error('Nodemailer sending error:', mailError.message);
      // If email provider fails, return the error clearly
      return res.status(500).json({
        success: false,
        message: `Failed to dispatch email to ${cleanEmail}: ${mailError.message}`,
        dev_code: process.env.NODE_ENV !== 'production' ? otpCode : undefined
      });
    }

    return res.status(200).json({
      success: true,
      message: `Verification code successfully sent to ${cleanEmail}`,
      data: {
        email: cleanEmail,
        expiresAt: expiresAt,
        // Provided in non-production for testing convenience
        ...(process.env.NODE_ENV !== 'production' && { dev_code: otpCode })
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/otp/verify-email-otp
 * @desc    Verify submitted 6-digit code for email and delete upon success
 * @access  Public
 */
router.post('/verify-email-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Both email address and 6-digit verification code are required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    // Find the OTP document in MongoDB
    const otpRecord = await EmailOtp.findOne({ email: cleanEmail });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'No active verification code found for this email. Please request a new code.'
      });
    }

    // Check if code has expired
    if (new Date() > new Date(otpRecord.expiresAt)) {
      await EmailOtp.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.'
      });
    }

    // Verify code match
    if (otpRecord.code !== cleanCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check your email and try again.'
      });
    }

    // Code matched! Delete OTP to prevent reuse
    await EmailOtp.deleteOne({ _id: otpRecord._id });

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully!'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
