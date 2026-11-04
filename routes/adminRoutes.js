const express = require('express');
const router = express.Router();
const {
  loginAdmin,
  getAdminOverview,
  deletePlayer,
  deleteTeam
} = require('../controllers/adminController');

// Master Admin login against MongoDB Atlas
router.post('/login', loginAdmin);

// Master Admin overview: all team admins and players list with summary metrics
router.get('/overview', getAdminOverview);

// Remove a player by ID
router.delete('/players/:id', deletePlayer);

// Remove a team by ID (unassigns active players safely)
router.delete('/teams/:id', deleteTeam);

module.exports = router;
