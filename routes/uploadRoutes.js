const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadFileToDrive } = require('../services/driveService');
const Attachment = require('../models/Attachment');

// Configure multer to store files in memory buffers (0 disk storage on Render)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { teamId } = req.body;
    const { originalname, mimetype, buffer } = req.file;

    console.log(`☁️ [Drive Upload] Uploading "${originalname}" to Google Drive...`);

    // 1. Upload file buffer to Google Drive
    const driveResult = await uploadFileToDrive(buffer, mimetype, `${Date.now()}_${originalname}`);

    // 2. Save lightweight metadata record in MongoDB Atlas
    const attachmentDoc = await Attachment.create({
      teamId: teamId || 'General',
      fileName: originalname,
      mimeType: mimetype,
      driveFileId: driveResult.fileId,
      viewUrl: driveResult.viewUrl,
      downloadUrl: driveResult.downloadUrl
    });

    console.log(`✅ [Drive Upload] File stored in Drive & metadata saved in MongoDB ID: ${attachmentDoc._id}`);

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully to Google Drive',
      data: {
        fileId: attachmentDoc.driveFileId,
        viewUrl: attachmentDoc.viewUrl,
        fileName: attachmentDoc.fileName
      }
    });
  } catch (err) {
    console.error('❌ [Upload Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;