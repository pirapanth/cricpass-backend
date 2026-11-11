const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teamSchema = new mongoose.Schema(
  {
    team_id: {
      type: String,
      required: [true, 'Team ID is required (e.g., TEAM-001)'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    team_name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true
    },
    admin_name: {
      type: String,
      required: [true, 'Admin name is required'],
      trim: true
    },
    admin_email: {
      type: String,
      required: false,
      default: '',
      trim: true,
      lowercase: true
    },
    phone_number: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    password: {
      type: String,
      default: null,
      select: false
    },
    image_url: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Pre-save hook to securely hash password with bcryptjs
teamSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  // Check if not already a bcrypt hash
  if (!this.password.startsWith('$2a$') && !this.password.startsWith('$2b$')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

// Instance method to verify candidate password
teamSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) return false;
  if (!this.password) return false;
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) {
    return await bcrypt.compare(candidatePassword, this.password);
  }
  return this.password === candidatePassword;
};

module.exports = mongoose.model('Team', teamSchema);