const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    password: {
      type: String,
      required: [true, 'Password is required']
    },
    full_name: {
      type: String,
      default: 'Master Admin',
      trim: true
    },
    role: {
      type: String,
      enum: ['MASTER_ADMIN', 'SUPER_ADMIN'],
      default: 'MASTER_ADMIN'
    },
    phone_number: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Method to verify candidate password
adminSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) return false;
  // If stored as bcrypt hash
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) {
    return await bcrypt.compare(candidatePassword, this.password);
  }
  // Fallback to direct string match
  return this.password === candidatePassword;
};

// Static helper to seed default Master Admin in MongoDB Atlas
adminSchema.statics.seedDefaultAdmin = async function () {
  try {
    const existing = await this.findOne({ username: 'cricpass' });
    if (!existing) {
      const hashedPassword = await bcrypt.hash('cricpass@4599', 10);
      await this.create({
        username: 'cricpass',
        password: hashedPassword,
        full_name: 'CricPass Master Administrator',
        role: 'MASTER_ADMIN',
        phone_number: '+94770000000'
      });
      console.log('✅ Master Admin seeded in MongoDB Atlas (username: cricpass)');
    }
  } catch (error) {
    console.error('Error seeding default Master Admin in MongoDB Atlas:', error.message);
  }
};

module.exports = mongoose.model('Admin', adminSchema);
