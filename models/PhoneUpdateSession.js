const mongoose = require('mongoose');

const phoneUpdateSessionSchema = new mongoose.Schema(
  {
    team_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    old_phone_number: {
      type: String,
      required: true
    },
    new_phone_number: {
      type: String,
      required: true
    },
    old_phone_otp: {
      type: String,
      required: true
    },
    old_otp_verified: {
      type: Boolean,
      default: false
    },
    new_phone_otp: {
      type: String,
      default: null
    },
    new_otp_verified: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['PENDING_OLD_VERIFICATION', 'PENDING_NEW_VERIFICATION', 'COMPLETED', 'EXPIRED'],
      default: 'PENDING_OLD_VERIFICATION'
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes session TTL
      index: { expires: '10m' }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('PhoneUpdateSession', phoneUpdateSessionSchema);
