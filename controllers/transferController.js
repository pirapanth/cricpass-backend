const mongoose = require('mongoose');
const TransferRequest = require('../models/TransferRequest');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { generateOTP, sendSimulatedSMS } = require('../utils/otpGenerator');
const {
  getCoolingOffDaysForTransfer,
  calculateEligibleDate,
  getRemainingCoolingOffDays
} = require('../utils/coolingOffCalculator');

/**
 * @desc    Initiate a transfer request between two teams
 * @route   POST /api/transfers/initiate
 * @access  Public
 */
async function initiateTransfer(req, res, next) {
  try {
    const { player_id, new_team_id, transfer_type } = req.body;

    // Validate request body
    if (!player_id) {
      return res.status(400).json({ success: false, message: 'player_id is required' });
    }
    if (!new_team_id) {
      return res.status(400).json({ success: false, message: 'new_team_id is required' });
    }
    if (!transfer_type) {
      return res.status(400).json({
        success: false,
        message: 'transfer_type is required (ALLOWED or NOT_ALLOWED)'
      });
    }

    const normalizedTransferType = String(transfer_type).trim().toUpperCase();
    if (!['ALLOWED', 'NOT_ALLOWED'].includes(normalizedTransferType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid transfer_type. Must be either 'ALLOWED' or 'NOT_ALLOWED'"
      });
    }

    // 1. Locate player by ID or NIC
    let player = null;
    const trimmedPlayerInput = String(player_id).trim();

    if (mongoose.Types.ObjectId.isValid(trimmedPlayerInput)) {
      player = await Player.findById(trimmedPlayerInput);
    }
    if (!player) {
      player = await Player.findOne({ nic_number: trimmedPlayerInput.toUpperCase() });
    }
    if (!player) {
      return res.status(404).json({
        success: false,
        message: `Player '${player_id}' not found.`
      });
    }

    // 2. Verify player currently belongs to a team
    if (!player.current_team_id) {
      return res.status(400).json({
        success: false,
        message: 'Player is currently not assigned to any team. Assign player directly instead of transfer.'
      });
    }

    // Enforce that player must have status 'ACTIVE • Eligible to Play'
    if (player.status === 'COOLING_OFF') {
      const remainingDays = getRemainingCoolingOffDays(player.eligible_to_play_date);
      return res.status(400).json({
        success: false,
        message: `Transfer not allowed: Player is currently in a cooling-off period (${remainingDays} days remaining). Only players with 'ACTIVE • Eligible to Play' status can be transferred.`
      });
    }

    if (player.status === 'PENDING_TRANSFER') {
      return res.status(400).json({
        success: false,
        message: 'Transfer not allowed: Player is currently undergoing a team transfer. Another transfer cannot be initiated until the current one is completed.'
      });
    }

    if (player.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Transfer not allowed: Player status is '${player.status}'. Only players with 'ACTIVE • Eligible to Play' status can be transferred.`
      });
    }

    const currentTeam = await Team.findById(player.current_team_id);
    if (!currentTeam) {
      return res.status(404).json({
        success: false,
        message: 'Current team record not found for this player.'
      });
    }

    // 3. Locate new team by ID or team_id string
    let newTeam = null;
    const trimmedNewTeamInput = String(new_team_id).trim();

    if (mongoose.Types.ObjectId.isValid(trimmedNewTeamInput)) {
      newTeam = await Team.findById(trimmedNewTeamInput);
    }
    if (!newTeam) {
      newTeam = await Team.findOne({ team_id: trimmedNewTeamInput.toUpperCase() });
    }
    if (!newTeam) {
      return res.status(404).json({
        success: false,
        message: `New team '${new_team_id}' not found.`
      });
    }

    // 4. Ensure destination team is not the current team
    if (currentTeam._id.toString() === newTeam._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Player is already registered with this team. Target team must be different.'
      });
    }

    // 5. Check if there is already a PENDING transfer request for this player
    const existingPendingTransfer = await TransferRequest.findOne({
      player_id: player._id,
      status: 'PENDING'
    });

    if (existingPendingTransfer) {
      return res.status(409).json({
        success: false,
        message: 'A pending transfer request already exists for this player.',
        data: {
          pending_transfer_id: existingPendingTransfer._id,
          current_team_otp_verified: existingPendingTransfer.current_team_otp_verified,
          new_team_otp_verified: existingPendingTransfer.new_team_otp_verified
        }
      });
    }

    // 6. Generate OTPs for both team admins
    const currentTeamOtp = generateOTP(6);
    const newTeamOtp = generateOTP(6);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    // 7. Create transfer request document
    const transferRequest = new TransferRequest({
      player_id: player._id,
      current_team_id: currentTeam._id,
      new_team_id: newTeam._id,
      transfer_type: normalizedTransferType,
      status: 'PENDING',
      current_team_otp_verified: false,
      new_team_otp_verified: false,
      current_team_otp: currentTeamOtp,
      new_team_otp: newTeamOtp,
      otp_expires_at: otpExpiresAt
    });

    await transferRequest.save();

    // 8. Update player status to PENDING_TRANSFER
    player.status = 'PENDING_TRANSFER';
    await player.save();

    // 9. Dispatch simulated SMS notifications to both team admins
    sendSimulatedSMS(
      currentTeam.phone_number,
      `[CricPass] Transfer authorization OTP for ${player.full_name}: ${currentTeamOtp}. Transfer type: ${normalizedTransferType}. Valid for 15 minutes.`
    );
    sendSimulatedSMS(
      newTeam.phone_number,
      `[CricPass] Transfer authorization OTP for accepting ${player.full_name}: ${newTeamOtp}. Transfer type: ${normalizedTransferType}. Valid for 15 minutes.`
    );

    // Populate for response
    const populatedTransfer = await TransferRequest.findById(transferRequest._id)
      .populate('player_id', 'full_name nic_number phone_number status')
      .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
      .populate('new_team_id', 'team_id team_name admin_name admin_email phone_number');

    return res.status(201).json({
      success: true,
      message: 'Transfer request initiated successfully.',
      data: {
        transfer: populatedTransfer,
        otp_expires_at: otpExpiresAt,
        current_team_admin: {
          team_name: currentTeam.team_name,
          admin_name: currentTeam.admin_name,
          admin_email: currentTeam.admin_email,
          phone_number: currentTeam.phone_number
        },
        new_team_admin: {
          team_name: newTeam.team_name,
          admin_name: newTeam.admin_name,
          admin_email: newTeam.admin_email,
          phone_number: newTeam.phone_number
        },
        dev_otps: {
          current_team_admin: {
            team_name: currentTeam.team_name,
            phone_number: currentTeam.phone_number,
            otp: currentTeamOtp
          },
          new_team_admin: {
            team_name: newTeam.team_name,
            phone_number: newTeam.phone_number,
            otp: newTeamOtp
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Verify dual OTPs for transfer request
 * @route   POST /api/transfers/verify-otp
 * @access  Public
 */
async function verifyTransferOtp(req, res, next) {
  try {
    const {
      transfer_id,
      current_team_otp,
      new_team_otp,
      role,
      otp,
      email_verified
    } = req.body;

    if (!transfer_id) {
      return res.status(400).json({ success: false, message: 'transfer_id is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(transfer_id)) {
      return res.status(400).json({ success: false, message: 'Invalid transfer_id format' });
    }

    // Retrieve transfer including hidden OTP fields
    const transfer = await TransferRequest.findById(transfer_id).select(
      '+current_team_otp +new_team_otp'
    );

    if (!transfer) {
      return res.status(404).json({ success: false, message: 'Transfer request not found' });
    }

    if (transfer.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Transfer request is already ${transfer.status}`
      });
    }

    // Check expiry
    if (transfer.otp_expires_at && new Date() > new Date(transfer.otp_expires_at)) {
      return res.status(400).json({
        success: false,
        message: 'Transfer authorization expired. Please initiate a new transfer request.'
      });
    }

    // Handle Email OTP verification callback
    if (email_verified) {
      const normalizedRole = String(role || '').trim().toUpperCase();
      if (['CURRENT_TEAM', 'CURRENT', 'CURRENT_ADMIN'].includes(normalizedRole)) {
        transfer.current_team_otp_verified = true;
      } else if (['NEW_TEAM', 'NEW', 'NEW_ADMIN'].includes(normalizedRole)) {
        transfer.new_team_otp_verified = true;
      } else {
        // Direct dual verification
        transfer.current_team_otp_verified = true;
        transfer.new_team_otp_verified = true;
      }
    } else {
      // Standard numeric OTP check
      let suppliedCurrentOtp = current_team_otp || null;
      let suppliedNewOtp = new_team_otp || null;

      if (role && otp) {
        const normalizedRole = String(role).trim().toUpperCase();
        if (['CURRENT_TEAM', 'CURRENT', 'CURRENT_ADMIN'].includes(normalizedRole)) {
          suppliedCurrentOtp = otp;
        } else if (['NEW_TEAM', 'NEW', 'NEW_ADMIN'].includes(normalizedRole)) {
          suppliedNewOtp = otp;
        }
      }

      if (!suppliedCurrentOtp && !suppliedNewOtp) {
        return res.status(400).json({
          success: false,
          message: 'Please provide verification code or email verification confirmation'
        });
      }

      // Verify Current Team Admin OTP if provided
      if (suppliedCurrentOtp) {
        if (String(suppliedCurrentOtp).trim() === String(transfer.current_team_otp)) {
          transfer.current_team_otp_verified = true;
        } else {
          return res.status(400).json({
            success: false,
            message: 'Invalid Current Team Admin OTP'
          });
        }
      }

      // Verify New Team Admin OTP if provided
      if (suppliedNewOtp) {
        if (String(suppliedNewOtp).trim() === String(transfer.new_team_otp)) {
          transfer.new_team_otp_verified = true;
        } else {
          return res.status(400).json({
            success: false,
            message: 'Invalid New Team Admin OTP'
          });
        }
      }
    }

    // Check approval criteria:
    // - For 'NOT_ALLOWED': Only New Team Admin verification is required!
    // - For 'ALLOWED': Both Current Team Admin AND New Team Admin verifications are required!
    const isApproved =
      (transfer.transfer_type === 'ALLOWED' && transfer.current_team_otp_verified && transfer.new_team_otp_verified) ||
      (transfer.transfer_type === 'NOT_ALLOWED' && transfer.new_team_otp_verified);

    if (isApproved) {
      transfer.status = 'APPROVED';
      await transfer.save();

      // Determine cooling off days:
      // ALLOWED -> 14 days, NOT_ALLOWED -> 30 days (1 month cooling off)
      const coolingDays = getCoolingOffDaysForTransfer(transfer.transfer_type);
      const eligibleToPlayDate = calculateEligibleDate(coolingDays);

      // Update Player record in MongoDB Atlas
      const player = await Player.findById(transfer.player_id);
      if (player) {
        player.current_team_id = transfer.new_team_id;
        player.status = 'COOLING_OFF';
        player.eligible_to_play_date = eligibleToPlayDate;
        await player.save();
      }

      const populatedTransfer = await TransferRequest.findById(transfer._id)
        .populate('player_id', 'full_name nic_number phone_number status eligible_to_play_date')
        .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
        .populate('new_team_id', 'team_id team_name admin_name admin_email phone_number');

      return res.status(200).json({
        success: true,
        message: transfer.transfer_type === 'ALLOWED'
          ? `Both Team Admins verified successfully! Transfer approved with a ${coolingDays}-day cooling-off period.`
          : `Receiving Team Admin verified successfully! Contested transfer approved with a mandatory ${coolingDays}-day cooling-off period.`,
        data: {
          transfer: populatedTransfer,
          player_update: {
            player_id: player._id,
            full_name: player.full_name,
            new_team_id: transfer.new_team_id,
            status: player.status,
            eligible_to_play_date: eligibleToPlayDate,
            cooling_off_days: coolingDays,
            remaining_cooling_off_days: coolingDays,
            is_eligible_to_play: false
          }
        }
      });
    }

    // Partial verification (waiting for remaining approval)
    await transfer.save();

    return res.status(200).json({
      success: true,
      message: transfer.current_team_otp_verified
        ? 'Current Team Admin verified. Awaiting New Team Admin authorization.'
        : 'New Team Admin verified. Awaiting Current Team Admin authorization.',
      data: {
        transfer_id: transfer._id,
        current_team_otp_verified: transfer.current_team_otp_verified,
        new_team_otp_verified: transfer.new_team_otp_verified,
        status: transfer.status
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get all transfer requests
 * @route   GET /api/transfers
 * @access  Public
 */
async function getAllTransfers(req, res, next) {
  try {
    const { status, player_id } = req.query;
    const filter = {};

    if (status) {
      filter.status = status.toUpperCase();
    }
    if (player_id && mongoose.Types.ObjectId.isValid(player_id)) {
      filter.player_id = player_id;
    }

    const transfers = await TransferRequest.find(filter)
      .populate('player_id', 'full_name nic_number phone_number status')
      .populate('current_team_id', 'team_id team_name admin_name')
      .populate('new_team_id', 'team_id team_name admin_name')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: transfers.length,
      data: transfers
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get single transfer request by ID
 * @route   GET /api/transfers/:id
 * @access  Public
 */
async function getTransferById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid transfer ID format' });
    }

    const transfer = await TransferRequest.findById(id)
      .populate('player_id', 'full_name nic_number phone_number status eligible_to_play_date')
      .populate('current_team_id', 'team_id team_name admin_name phone_number')
      .populate('new_team_id', 'team_id team_name admin_name phone_number');

    if (!transfer) {
      return res.status(404).json({ success: false, message: 'Transfer request not found' });
    }

    return res.status(200).json({
      success: true,
      data: transfer
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Grant mutual clearance for a contested (30-day) transfer, reducing cooling-off to 14 days
 * @route   POST /api/transfers/grant-mutual-clearance
 * @access  Public
 */
async function grantMutualClearance(req, res, next) {
  try {
    const { player_id, nic_number, transfer_id } = req.body;

    let player = null;
    if (player_id && mongoose.Types.ObjectId.isValid(player_id)) {
      player = await Player.findById(player_id);
    }
    if (!player && nic_number) {
      player = await Player.findOne({ nic_number: String(nic_number).trim().toUpperCase() });
    }
    if (!player && transfer_id && mongoose.Types.ObjectId.isValid(transfer_id)) {
      const tr = await TransferRequest.findById(transfer_id);
      if (tr) player = await Player.findById(tr.player_id);
    }

    if (!player) {
      return res.status(404).json({ success: false, message: 'Player not found' });
    }

    // Find the relevant 30-day approved transfer request
    const filter = {
      player_id: player._id,
      status: 'APPROVED',
      transfer_type: 'NOT_ALLOWED'
    };
    if (transfer_id && mongoose.Types.ObjectId.isValid(transfer_id)) {
      filter._id = transfer_id;
    }

    const transfer = await TransferRequest.findOne(filter)
      .populate('current_team_id', 'team_id team_name admin_name admin_email phone_number')
      .populate('new_team_id', 'team_id team_name admin_name admin_email phone_number')
      .sort({ createdAt: -1 });

    if (!transfer) {
      return res.status(400).json({
        success: false,
        message: 'No contested (30-day) transfer request found for this player to grant clearance.'
      });
    }

    // Recalculate 14 days cooling-off period from the date the transfer occurred
    const transferDate = new Date(transfer.updatedAt || transfer.createdAt);
    const newEligibleDate = new Date(transferDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    const now = new Date();

    transfer.transfer_type = 'ALLOWED';
    await transfer.save();

    let isNowActive = false;
    if (now >= newEligibleDate) {
      // 14 days have already elapsed!
      player.status = 'ACTIVE';
      player.eligible_to_play_date = now;
      isNowActive = true;
    } else {
      player.status = 'COOLING_OFF';
      player.eligible_to_play_date = newEligibleDate;
    }
    await player.save();

    const remainingDays = getRemainingCoolingOffDays(player.eligible_to_play_date);

    return res.status(200).json({
      success: true,
      message: isNowActive
        ? `Mutual clearance granted by ${transfer.current_team_id?.team_name}! More than 14 days have elapsed since transfer. Player is now ACTIVE and eligible to play!`
        : `Mutual clearance granted by ${transfer.current_team_id?.team_name}! Cooling-off period successfully reduced from 30 days to 14 days. Eligible on: ${newEligibleDate.toLocaleDateString()}.`,
      data: {
        player_id: player._id,
        full_name: player.full_name,
        nic_number: player.nic_number,
        status: player.status,
        eligible_to_play_date: player.eligible_to_play_date,
        remaining_cooling_off_days: remainingDays,
        is_eligible_to_play: isNowActive,
        transfer
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initiateTransfer,
  verifyTransferOtp,
  getAllTransfers,
  getTransferById,
  grantMutualClearance
};
