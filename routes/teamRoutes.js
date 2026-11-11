const express = require('express');
const router = express.Router();
const {
  loginTeamAdmin,
  registerTeam,
  updateTeamPhone,
  getAllTeams,
  getTeamById,
  lookupTeamsByPhone,
  changeTeamPassword,
  changeTeamEmail
} = require('../controllers/teamController');

// Team Admin login (Authenticates against MongoDB Atlas database)
router.post('/login', loginTeamAdmin);

// Register a new team
router.post('/register', registerTeam);

// Lookup team(s) by admin WhatsApp phone number (for Forgot Password flow)
router.post('/lookup-by-phone', lookupTeamsByPhone);

// Change team admin password
router.put('/change-password', changeTeamPassword);

// Change team admin email
router.put('/change-email', changeTeamEmail);

// Two-step OTP flow for team admin phone number change
router.put('/update-phone', updateTeamPhone);

// Additional semantic sub-routes for step-by-step phone update
router.post('/update-phone/initiate', (req, res, next) => {
  req.body.step = 'INITIATE';
  return updateTeamPhone(req, res, next);
});

router.post('/update-phone/verify-old', (req, res, next) => {
  req.body.step = 'VERIFY_OLD';
  return updateTeamPhone(req, res, next);
});

router.post('/update-phone/verify-new', (req, res, next) => {
  req.body.step = 'VERIFY_NEW';
  return updateTeamPhone(req, res, next);
});

// List all teams
router.get('/', getAllTeams);

// Get single team by ID or team_id (with player roster)
router.get('/:id', getTeamById);

module.exports = router;
