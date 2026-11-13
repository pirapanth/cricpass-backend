const mongoose = require('mongoose');

const baileysAuthSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // e.g. "cricpass_whatsapp_session"
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});

module.exports = mongoose.model('BaileysAuth', baileysAuthSchema);