const express = require('express');
const router = express.Router();
const {
  searchPlayerByNic,
  registerPlayer,
  getAllPlayers,
  getPlayerById
} = require('../controllers/playerController');

// Search player by NIC (returns cooling off details and current team)
router.get('/search/:nic', searchPlayerByNic);

// Register a new player
router.post('/register', registerPlayer);

// List all players (with optional filters: ?status=ACTIVE&team_id=...)
router.get('/', getAllPlayers);

// Get player by ID
router.get('/:id', getPlayerById);

module.exports = router;
