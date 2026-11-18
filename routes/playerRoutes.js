const express = require('express');
const router = express.Router();
const {
  searchPlayerByNic,
  registerPlayer,
  bulkRegisterPlayers,
  getAllPlayers,
  getPlayerById
} = require('../controllers/playerController');

// Search player by NIC (returns cooling off details and current team)
router.get('/search/:nic', searchPlayerByNic);

// Register a single new player
router.post('/register', registerPlayer);

// Bulk register multiple players in a single batch
router.post('/bulk-register', bulkRegisterPlayers);

// List all players (with optional filters: ?status=ACTIVE&team_id=...)
router.get('/', getAllPlayers);

// Get player by ID
router.get('/:id', getPlayerById);

module.exports = router;
