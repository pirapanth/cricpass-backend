const mongoose = require('mongoose');

const emailOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    code: {
      type: String,
      required: true,
      trim: true
    },
    purpose: {
      type: String,
      default: 'Verification'
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 5 * 60 * 1000), // 5 minutes TTL
      index: { expires: 300 } // Auto-delete from MongoDB after 5 minutes
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('EmailOtp', emailOtpSchema);
