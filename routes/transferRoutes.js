const express = require('express');
const router = express.Router();
const {
  initiateTransfer,
  verifyTransferOtp,
  getAllTransfers,
  getTransferById,
  grantMutualClearance
} = require('../controllers/transferController');

// Initiate a transfer request
router.post('/initiate', initiateTransfer);

// Verify dual OTPs for transfer
router.post('/verify-otp', verifyTransferOtp);

// Grant mutual clearance (reduces 30-day cooling-off to 14 days)
router.post('/grant-mutual-clearance', grantMutualClearance);

// List all transfer requests (with optional filters: ?status=PENDING&player_id=...)
router.get('/', getAllTransfers);

// Get transfer request by ID
router.get('/:id', getTransferById);

module.exports = router;
