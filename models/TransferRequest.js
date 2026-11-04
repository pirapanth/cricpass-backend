const mongoose = require('mongoose');

const transferRequestSchema = new mongoose.Schema(
  {
    player_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'Player ID is required']
    },
    current_team_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'Current team ID is required']
    },
    new_team_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: [true, 'New team ID is required']
    },
    transfer_type: {
      type: String,
      enum: {
        values: ['ALLOWED', 'NOT_ALLOWED'],
        message: '{VALUE} is not a valid transfer type. Must be either ALLOWED or NOT_ALLOWED'
      },
      required: [true, 'Transfer type is required (ALLOWED or NOT_ALLOWED)']
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'APPROVED', 'REJECTED'],
        message: '{VALUE} is not a valid status'
      },
      default: 'PENDING'
    },
    current_team_otp_verified: {
      type: Boolean,
      default: false
    },
    new_team_otp_verified: {
      type: Boolean,
      default: false
    },
    current_team_otp: {
      type: String,
      select: false
    },
    new_team_otp: {
      type: String,
      select: false
    },
    otp_expires_at: {
      type: Date
    },
    created_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Helpful index for querying active transfers for a player
transferRequestSchema.index({ player_id: 1, status: 1 });

module.exports = mongoose.model('TransferRequest', transferRequestSchema);
