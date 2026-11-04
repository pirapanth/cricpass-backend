const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema(
  {
    full_name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true
    },
    nic_number: {
      type: String,
      required: [true, 'NIC number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    phone_number: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    image_url: {
      type: String,
      trim: true,
      default: null
    },
    current_team_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'COOLING_OFF', 'PENDING_TRANSFER'],
        message: '{VALUE} is not a valid player status. Allowed: ACTIVE, COOLING_OFF, PENDING_TRANSFER'
      },
      default: 'ACTIVE'
    },
    eligible_to_play_date: {
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

// Virtual to calculate remaining cooling-off days
playerSchema.virtual('remaining_cooling_off_days').get(function () {
  if (!this.eligible_to_play_date) return 0;
  const now = new Date();
  const eligibleDate = new Date(this.eligible_to_play_date);
  const diffMs = eligibleDate.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
});

// Virtual to check if player is eligible to play today
playerSchema.virtual('is_eligible_to_play').get(function () {
  if (this.status === 'PENDING_TRANSFER') return false;
  if (!this.eligible_to_play_date) return true;
  return new Date() >= new Date(this.eligible_to_play_date);
});

module.exports = mongoose.model('Player', playerSchema);
