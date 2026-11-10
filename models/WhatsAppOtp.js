const mongoose = require('mongoose');

const whatsAppOtpSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
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

module.exports = mongoose.model('WhatsAppOtp', whatsAppOtpSchema);
