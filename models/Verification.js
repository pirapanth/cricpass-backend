const mongoose = require('mongoose');

const verificationSchema = new mongoose.Schema({
  verifyToken: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  teamName: { type: String, required: true },
  adminName: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  purpose: { type: String, default: 'Team Registration' },
  verified: { type: Boolean, default: false }, // Becomes true once OTP is validated on website
  expiresAt: { type: Date, required: true, index: { expires: 0 } } // Auto-deletes when expired
});

module.exports = mongoose.model('Verification', verificationSchema);