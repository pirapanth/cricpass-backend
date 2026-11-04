const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Player = require('../models/Player');
const Team = require('../models/Team');
const TransferRequest = require('../models/TransferRequest');
const { getRemainingCoolingOffDays, isPlayerEligibleToPlay } = require('../utils/coolingOffCalculator');

/**
 * @desc    Master Admin Login (Authenticates against MongoDB Atlas database)
 * @route   POST /api/admin/login
 * @access  Public
 */
async function loginAdmin(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    // Query admin in MongoDB Atlas
    const admin = await Admin.findOne({ username: cleanUsername });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: `Admin user '${cleanUsername}' not found in database.`
      });
    }

    const isMatch = await admin.comparePassword(cleanPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password for this administrator account.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Master Admin authenticated successfully from database',
      data: {
        admin_id: admin._id,
        username: admin.username,
        full_name: admin.full_name,
        role: admin.role,
        phone_number: admin.phone_number
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Fetch comprehensive overview (all team admins, player list, and system metrics) for Master Admin
 * @route   GET /api/admin/overview
 * @access  Admin
 */
async function getAdminOverview(req, res, next) {
  try {
    // 1. Fetch all teams
    const teams = await Team.find().sort({ team_name: 1 }).lean();

    // 2. Fetch all players populated with current team
    const players = await Player.find()
      .populate('current_team_id', 'team_id team_name admin_name phone_number')
      .sort({ createdAt: -1 })
      .lean();

    // 3. Format players with remaining cooling off days and eligibility
    const formattedPlayers = players.map((player) => {
      const remainingDays = getRemainingCoolingOffDays(player.eligible_to_play_date);
      const eligible = isPlayerEligibleToPlay(player.status, player.eligible_to_play_date);

      return {
        ...player,
        remaining_cooling_off_days: remainingDays,
        is_eligible_to_play: eligible,
        team_name: player.current_team_id ? player.current_team_id.team_name : 'Free Agent / Unassigned'
      };
    });

    // 4. Map player counts per team for admin view
    const teamPlayerCountMap = {};
    for (const player of players) {
      if (player.current_team_id) {
        const teamIdStr = player.current_team_id._id.toString();
        teamPlayerCountMap[teamIdStr] = (teamPlayerCountMap[teamIdStr] || 0) + 1;
      }
    }

    const formattedTeams = teams.map((team) => ({
      _id: team._id,
      team_id: team.team_id,
      team_name: team.team_name,
      admin_name: team.admin_name,
      phone_number: team.phone_number,
      image_url: team.image_url,
      total_players: teamPlayerCountMap[team._id.toString()] || 0,
      createdAt: team.createdAt
    }));

    // 5. Fetch recent transfer requests (latest 10)
    const recentTransfers = await TransferRequest.find()
      .populate('player_id', 'full_name nic_number')
      .populate('current_team_id', 'team_id team_name')
      .populate('new_team_id', 'team_id team_name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // 6. Aggregate summary metrics
    const summary = {
      total_teams: teams.length,
      total_players: players.length,
      active_players: players.filter((p) => p.status === 'ACTIVE').length,
      cooling_off_players: players.filter((p) => p.status === 'COOLING_OFF').length,
      pending_transfers_players: players.filter((p) => p.status === 'PENDING_TRANSFER').length,
      unassigned_players: players.filter((p) => !p.current_team_id).length,
      pending_transfer_requests: await TransferRequest.countDocuments({ status: 'PENDING' }),
      approved_transfer_requests: await TransferRequest.countDocuments({ status: 'APPROVED' })
    };

    return res.status(200).json({
      success: true,
      message: 'Master Admin overview retrieved successfully',
      data: {
        summary,
        teams: formattedTeams,
        players: formattedPlayers,
        recent_transfers: recentTransfers
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Remove a player by ID
 * @route   DELETE /api/admin/players/:id
 * @access  Admin
 */
async function deletePlayer(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid player ID format' });
    }

    const player = await Player.findById(id);
    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    // Cancel / remove any pending transfer requests for this player
    await TransferRequest.deleteMany({ player_id: player._id, status: 'PENDING' });

    await Player.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: `Player '${player.full_name}' (NIC: ${player.nic_number}) deleted successfully.`,
      data: {
        deleted_player_id: id,
        full_name: player.full_name,
        nic_number: player.nic_number
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Remove a team by ID
 * @route   DELETE /api/admin/teams/:id
 * @access  Admin
 */
async function deleteTeam(req, res, next) {
  try {
    const { id } = req.params;

    let team = null;
    const trimmed = String(id).trim();

    if (mongoose.Types.ObjectId.isValid(trimmed)) {
      team = await Team.findById(trimmed);
    }
    if (!team) {
      team = await Team.findOne({ team_id: trimmed.toUpperCase() });
    }

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Unassign all players currently in this team (revert them to free agents)
    const affectedPlayersResult = await Player.updateMany(
      { current_team_id: team._id },
      { $set: { current_team_id: null, status: 'ACTIVE' } }
    );

    // Cancel any active pending transfer requests involving this team
    await TransferRequest.updateMany(
      {
        $or: [{ current_team_id: team._id }, { new_team_id: team._id }],
        status: 'PENDING'
      },
      {
        $set: { status: 'REJECTED' }
      }
    );

    await Team.findByIdAndDelete(team._id);

    return res.status(200).json({
      success: true,
      message: `Team '${team.team_name}' (${team.team_id}) deleted successfully.`,
      data: {
        deleted_team_id: team._id,
        team_id: team.team_id,
        team_name: team.team_name,
        unassigned_players_count: affectedPlayersResult.modifiedCount
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  loginAdmin,
  getAdminOverview,
  deletePlayer,
  deleteTeam
};
