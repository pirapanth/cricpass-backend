const mongoose = require('mongoose');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { getRemainingCoolingOffDays, isPlayerEligibleToPlay } = require('../utils/coolingOffCalculator');
const { formatDisplayPhone } = require('../services/whatsappService');

/**
 * @desc    Search player by NIC number
 * @route   GET /api/players/search/:nic
 * @access  Public
 */
async function searchPlayerByNic(req, res, next) {
  try {
    const { nic } = req.params;

    if (!nic || !nic.trim()) {
      return res.status(400).json({
        success: false,
        message: 'NIC number parameter is required'
      });
    }

    const formattedNic = nic.trim().toUpperCase();

    // Query player by NIC and populate current team details
    const player = await Player.findOne({ nic_number: formattedNic }).populate(
      'current_team_id',
      'team_id team_name admin_name admin_email phone_number image_url'
    );

    if (!player) {
      return res.status(404).json({
        success: false,
        message: `Player with NIC '${formattedNic}' not found.`
      });
    }

    // Auto-update status if cooling-off period has elapsed
    const now = new Date();
    if (player.status === 'COOLING_OFF' && player.eligible_to_play_date && now >= new Date(player.eligible_to_play_date)) {
      player.status = 'ACTIVE';
      await player.save();
    }

    const remainingCoolingOffDays = getRemainingCoolingOffDays(player.eligible_to_play_date);
    const eligibleToPlay = isPlayerEligibleToPlay(player.status, player.eligible_to_play_date);

    // Fetch latest transfer record if in cooling-off or pending transfer state
    let latestTransfer = null;
    let pendingTransfer = null;
    if (player.status === 'COOLING_OFF') {
      const TransferRequest = require('../models/TransferRequest');
      latestTransfer = await TransferRequest.findOne({ player_id: player._id, status: 'APPROVED' })
        .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
        .populate('new_team_id', 'team_id team_name admin_name admin_email phone_number')
        .sort({ createdAt: -1 });
    } else if (player.status === 'PENDING_TRANSFER') {
      const TransferRequest = require('../models/TransferRequest');
      pendingTransfer = await TransferRequest.findOne({ player_id: player._id, status: 'PENDING' })
        .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
        .populate('new_team_id', 'team_id team_name admin_name admin_email phone_number')
        .sort({ createdAt: -1 });
    }

    return res.status(200).json({
      success: true,
      message: 'Player retrieved successfully',
      data: {
        _id: player._id,
        full_name: player.full_name,
        nic_number: player.nic_number,
        phone_number: player.phone_number,
        image_url: player.image_url,
        status: player.status,
        eligible_to_play_date: player.eligible_to_play_date,
        remaining_cooling_off_days: remainingCoolingOffDays,
        is_eligible_to_play: eligibleToPlay,
        current_team: player.current_team_id
          ? {
              _id: player.current_team_id._id,
              team_id: player.current_team_id.team_id,
              team_name: player.current_team_id.team_name,
              admin_name: player.current_team_id.admin_name,
              admin_email: player.current_team_id.admin_email,
              phone_number: player.current_team_id.phone_number
            }
          : null,
        latest_transfer: latestTransfer,
        pending_transfer: pendingTransfer,
        created_at: player.createdAt,
        updated_at: player.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Register a new player with NIC uniqueness validation and optional team assignment
 * @route   POST /api/players/register
 * @access  Public
 */
async function registerPlayer(req, res, next) {
  try {
    const { full_name, nic_number, phone_number, image_url, current_team_id } = req.body;

    // Validate required fields
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }
    if (!nic_number || !nic_number.trim()) {
      return res.status(400).json({ success: false, message: 'NIC number is required' });
    }
    if (!phone_number || !phone_number.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const formattedPhone = formatDisplayPhone(phone_number.trim());
    if (!/^\+94[1-9]\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Contact phone number must be +94 followed by 9 digits without a leading 0 (e.g. +94771454651)'
      });
    }

    const formattedNic = nic_number.trim().toUpperCase();

    // Check if player with this NIC already exists
    const existingPlayer = await Player.findOne({ nic_number: formattedNic });
    if (existingPlayer) {
      return res.status(409).json({
        success: false,
        message: `Player with NIC '${formattedNic}' is already registered.`
      });
    }

    // Resolve team assignment if provided (supports both ObjectId and team_id string)
    let assignedTeamId = null;
    let assignedTeam = null;

    if (current_team_id) {
      const trimmedTeamInput = String(current_team_id).trim();

      if (mongoose.Types.ObjectId.isValid(trimmedTeamInput)) {
        assignedTeam = await Team.findById(trimmedTeamInput);
      }

      if (!assignedTeam) {
        assignedTeam = await Team.findOne({ team_id: trimmedTeamInput.toUpperCase() });
      }

      if (!assignedTeam) {
        return res.status(404).json({
          success: false,
          message: `Team with identifier '${current_team_id}' not found.`
        });
      }

      assignedTeamId = assignedTeam._id;
    }

    // Create new player record
    const newPlayer = new Player({
      full_name: full_name.trim(),
      nic_number: formattedNic,
      phone_number: formattedPhone,
      image_url: image_url || null,
      current_team_id: assignedTeamId,
      status: 'ACTIVE',
      eligible_to_play_date: new Date()
    });

    await newPlayer.save();

    // Return created player with populated team
    const populatedPlayer = await Player.findById(newPlayer._id).populate(
      'current_team_id',
      'team_id team_name admin_name admin_email phone_number image_url'
    );

    return res.status(201).json({
      success: true,
      message: 'Player registered successfully',
      data: populatedPlayer
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get all players with optional status and team filtering
 * @route   GET /api/players
 * @access  Public
 */
async function getAllPlayers(req, res, next) {
  try {
    const { status, team_id } = req.query;
    const filter = {};

    if (status) {
      filter.status = status.toUpperCase();
    }

    if (team_id) {
      if (mongoose.Types.ObjectId.isValid(team_id)) {
        filter.current_team_id = team_id;
      } else {
        const team = await Team.findOne({ team_id: team_id.toUpperCase().trim() });
        if (team) {
          filter.current_team_id = team._id;
        }
      }
    }

    const players = await Player.find(filter)
      .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: players.length,
      data: players
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get single player by ID
 * @route   GET /api/players/:id
 * @access  Public
 */
async function getPlayerById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid player ID format' });
    }

    const player = await Player.findById(id).populate(
      'current_team_id',
      'team_id team_name admin_name admin_email phone_number image_url'
    );

    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    return res.status(200).json({
      success: true,
      data: player
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  searchPlayerByNic,
  registerPlayer,
  getAllPlayers,
  getPlayerById
};
