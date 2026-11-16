const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
  teamId: { type: String, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  driveFileId: { type: String, required: true, unique: true },
  viewUrl: { type: String, required: true },
  downloadUrl: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Attachment', AttachmentSchema);