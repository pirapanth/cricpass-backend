const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const WhatsAppOtp = require('../models/WhatsAppOtp');
const { sendWhatsAppOTP, formatPhoneNumber } = require('../services/whatsappService');

/**
 * @route   POST /api/otp/send-whatsapp-otp
 * @desc    Generate 6-digit OTP, store in MongoDB with 5m expiry, send via WhatsApp Web
 * @access  Public
 */
router.post('/send-whatsapp-otp', async (req, res, next) => {
  try {
    const rawPhone = req.body.phone || req.body.phoneNumber || req.body.email;
    const purpose = req.body.purpose || 'Verification';

    if (!rawPhone || !String(rawPhone).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Recipient WhatsApp phone number is required (with country code)'
      });
    }

    const cleanPhone = formatPhoneNumber(rawPhone);

    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please provide a valid number with country code (e.g., 9477XXXXXXX).'
      });
    }

    // Generate random 6-digit numeric OTP
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Delete any existing active OTP for this phone
    await WhatsAppOtp.deleteMany({ phone: cleanPhone });

    // Store new OTP in MongoDB Atlas
    await WhatsAppOtp.create({
      phone: cleanPhone,
      code: otpCode,
      purpose: purpose,
      expiresAt: expiresAt
    });

    // Send styled message via WhatsApp Web Client
    try {
      await sendWhatsAppOTP(cleanPhone, otpCode, purpose);
    } catch (waError) {
      console.error('WhatsApp sending error:', waError.message);
      // Return clear error if delivery failed
      return res.status(500).json({
        success: false,
        message: `Failed to dispatch WhatsApp message to +${cleanPhone}: ${waError.message}`,
        dev_code: process.env.NODE_ENV !== 'production' ? otpCode : undefined
      });
    }

    return res.status(200).json({
      success: true,
      message: `Verification code successfully sent to WhatsApp (+${cleanPhone})`,
      data: {
        phone: cleanPhone,
        expiresAt: expiresAt,
        ...(process.env.NODE_ENV !== 'production' && { dev_code: otpCode })
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/otp/verify-whatsapp-otp
 * @desc    Verify submitted 6-digit OTP for phone number and delete upon success
 * @access  Public
 */
router.post('/verify-whatsapp-otp', async (req, res, next) => {
  try {
    const rawPhone = req.body.phone || req.body.phoneNumber || req.body.email;
    const { code } = req.body;

    if (!rawPhone || !code) {
      return res.status(400).json({
        success: false,
        message: 'Both WhatsApp phone number and 6-digit verification code are required'
      });
    }

    const cleanPhone = formatPhoneNumber(rawPhone);
    const cleanCode = String(code).trim();

    // Find the OTP document in MongoDB
    const otpRecord = await WhatsAppOtp.findOne({ phone: cleanPhone });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'No active verification code found for this WhatsApp number. Please request a new code.'
      });
    }

    // Check if code has expired
    if (new Date() > new Date(otpRecord.expiresAt)) {
      await WhatsAppOtp.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.'
      });
    }

    // Verify code match
    if (otpRecord.code !== cleanCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check your WhatsApp and try again.'
      });
    }

    // Code matched! Delete OTP to prevent reuse
    await WhatsAppOtp.deleteOne({ _id: otpRecord._id });

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully!'
    });
  } catch (error) {
    next(error);
  }
});

// Legacy Aliases for Backward Compatibility
router.post('/send-email-otp', (req, res, next) => {
  req.url = '/send-whatsapp-otp';
  router.handle(req, res, next);
});

router.post('/verify-email-otp', (req, res, next) => {
  req.url = '/verify-whatsapp-otp';
  router.handle(req, res, next);
});

module.exports = router;
