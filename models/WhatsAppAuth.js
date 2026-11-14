const mongoose = require('mongoose');

const WhatsAppAuthSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});

module.exports = mongoose.model('WhatsAppAuth', WhatsAppAuthSchema);