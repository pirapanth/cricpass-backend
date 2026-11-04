const express = require('express');
const router = express.Router();
const { submitContactReport } = require('../controllers/contactController');

// Submit issue / contact inquiry
router.post('/submit', submitContactReport);

module.exports = router;
