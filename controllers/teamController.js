const mongoose = require('mongoose');
const Team = require('../models/Team');
const Player = require('../models/Player');
const PhoneUpdateSession = require('../models/PhoneUpdateSession');
const Verification = require('../models/Verification');
const { generateOTP, sendSimulatedSMS } = require('../utils/otpGenerator');
const { sendTeamCredentialsEmail } = require('../services/emailService');
const {
  startTeamAdminVerification,
  sendNewTeamRegistrationWhatsApp,
  sendPasswordChangedWhatsApp,
  sendWhatsAppNumberChangedWhatsApp,
  sendTeamCredentialsWhatsApp,
  formatDisplayPhone,
  formatPhoneNumber,
  isWhatsAppReady
} = require('../services/whatsappService');

/**
 * Helper to build normalized phone variants so teams stored as 077..., 9477..., or +9477... all match.
 */
function buildPhoneVariants(rawPhone) {
  const digits = formatPhoneNumber(rawPhone);
  if (!digits) return [];
  const variants = new Set([String(rawPhone).trim(), digits, `+${digits}`]);
  if (digits.startsWith('94') && digits.length === 11) {
    const local9 = digits.slice(2);
    variants.add(local9);
    variants.add(`0${local9}`);
  }
  return Array.from(variants);
}

/**
 * Helper to resolve team by ObjectId or team_id string (e.g. "TEAM-001")
 */
async function resolveTeam(identifier) {
  if (!identifier) return null;
  const trimmed = String(identifier).trim();
  if (mongoose.Types.ObjectId.isValid(trimmed)) {
    const team = await Team.findById(trimmed);
    if (team) return team;
  }
  return await Team.findOne({ team_id: trimmed.toUpperCase() });
}

/**
 * Helper to generate an automatic and unique Team ID
 * E.g., extracts acronym from team_name: "Colombo Lions" -> "COL-001" or "TEAM-001"
 */
async function generateUniqueTeamId(teamName) {
  let prefix = 'TEAM';
  if (teamName && typeof teamName === 'string') {
    const cleaned = teamName.replace(/[^a-zA-Z\s]/g, '').trim().toUpperCase();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      prefix = (words[0].slice(0, 2) + words[1].slice(0, 2)).toUpperCase();
    } else if (words.length === 1 && words[0].length >= 3) {
      prefix = words[0].slice(0, 3).toUpperCase();
    }
  }

  if (!prefix || prefix.length < 2) prefix = 'TEAM';

  // Check sequentially: PREFIX-001, PREFIX-002, ...
  for (let i = 1; i <= 999; i++) {
    const candidate = `${prefix}-${String(i).padStart(3, '0')}`;
    const exists = await Team.findOne({ team_id: candidate });
    if (!exists) {
      return candidate;
    }
  }

  // Fallback with random 4-digit number
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${randomSuffix}`;
}

/**
 * @desc    Team Admin Login via Team ID and Password (or Phone Number)
 * @route   POST /api/teams/login
 * @access  Public
 */
async function loginTeamAdmin(req, res, next) {
  try {
    const { team_id, password, phone_number } = req.body;
    const credential = password || phone_number;

    if (!team_id || !credential) {
      return res.status(400).json({
        success: false,
        message: 'Both Team ID and Password are required'
      });
    }

    const trimmedInput = String(team_id).trim();
    const normalizedTeamId = trimmedInput.toUpperCase();
    const cleanCredential = String(credential).trim();

    // Helper to safely escape regex characters
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Query team by team_id OR team_name (case-insensitive) with hidden password field
    const team = await Team.findOne({
      $or: [
        { team_id: normalizedTeamId },
        { team_name: { $regex: new RegExp(`^${escapeRegex(trimmedInput)}$`, 'i') } }
      ]
    }).select('+password');

    if (!team) {
      return res.status(401).json({
        success: false,
        message: `Invalid credentials. No team matching '${trimmedInput}' was found.`
      });
    }

    // Verify password:
    // 1. If encrypted password exists on record, verify with bcrypt
    // 2. Or fallback to phone_number match for legacy teams registered before passwords
    let isMatch = false;
    if (team.password) {
      isMatch = await team.comparePassword(cleanCredential);
    }
    if (!isMatch && team.phone_number && cleanCredential === team.phone_number) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password or credentials. Please check your password.'
      });
    }

    // Fetch team's player roster from MongoDB Atlas
    const players = await Player.find({ current_team_id: team._id }).sort({ full_name: 1 });

    // Clean password from returned object
    const teamObj = team.toObject();
    delete teamObj.password;

    return res.status(200).json({
      success: true,
      message: 'Team Admin authenticated successfully from database',
      data: {
        team: teamObj,
        player_count: players.length,
        players
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Step 1: Start Team Admin Verification (Validates uniqueness, saves session in Verification collection, returns verifyToken)
 * @route   POST /api/teams/register
 * @access  Public
 */
async function registerTeam(req, res, next) {
  try {
    const {
      adminName: rawAdminName,
      admin_name,
      teamName: rawTeamName,
      team_name,
      phone: rawPhone,
      phone_number,
      email: rawEmail,
      admin_email
    } = req.body;

    const adminName = (rawAdminName || admin_name || '').trim();
    const teamName = (rawTeamName || team_name || '').trim();
    const phone = (rawPhone || phone_number || '').trim();
    const email = (rawEmail || admin_email || '').trim().toLowerCase();

    // Validate required fields
    if (!teamName) {
      return res.status(400).json({ success: false, message: 'Team / Club Name is required.' });
    }
    if (!adminName) {
      return res.status(400).json({ success: false, message: 'Admin Full Name is required.' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'WhatsApp Phone Number is required.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'A valid Admin Email is required.' });
    }

    const formattedPhone = formatDisplayPhone(phone);
    if (!/^\+94[1-9]\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp number must be +94 followed by 9 digits without a leading 0 (e.g. +94770000000).'
      });
    }

    // Check if team name, phone, or email is already registered in main Team collection
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingTeam = await Team.findOne({
      $or: [
        { team_name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') } },
        { phone_number: formattedPhone },
        { admin_email: email }
      ]
    });

    if (existingTeam) {
      if (existingTeam.team_name.toLowerCase() === teamName.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: `Team name "${teamName}" is already registered. Please choose another name.`
        });
      }
      if (existingTeam.phone_number === formattedPhone) {
        return res.status(409).json({
          success: false,
          message: `WhatsApp number "${formattedPhone}" is already registered to a team.`
        });
      }
      if (existingTeam.admin_email && existingTeam.admin_email.toLowerCase() === email.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: `Admin email "${email}" is already registered to a team.`
        });
      }
      return res.status(409).json({
        success: false,
        message: 'This team name, phone number, or email is already registered.'
      });
    }

    // Call startTeamAdminVerification from whatsappService.js
    const verificationResult = await startTeamAdminVerification({
      adminName,
      teamName,
      phone: formattedPhone,
      email,
      purpose: 'Team Registration'
    });

    return res.status(200).json({
      success: true,
      method: verificationResult.method,
      verifyToken: verificationResult.verifyToken
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Step 2: Verify 6-digit OTP
 * @route   POST /api/teams/verify-otp
 * @access  Public
 */
async function verifyTeamOtp(req, res, next) {
  try {
    const { verifyToken, otp } = req.body;

    if (!verifyToken || !otp) {
      return res.status(400).json({
        success: false,
        error: 'verifyToken and otp are required.',
        message: 'verifyToken and otp are required.'
      });
    }

    const cleanToken = String(verifyToken).trim();
    const cleanOtp = String(otp).trim();

    const record = await Verification.findOne({
      verifyToken: cleanToken,
      otp: cleanOtp,
      expiresAt: { $gt: new Date() }
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired OTP.',
        message: 'Invalid or expired OTP.'
      });
    }

    record.verified = true;
    await record.save();

    return res.status(200).json({
      success: true,
      verified: true,
      verifyToken: record.verifyToken
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Step 3: Complete Registration (Set Password & Create Team)
 * @route   POST /api/teams/complete-registration
 * @access  Public
 */
async function completeTeamRegistration(req, res, next) {
  try {
    const { verifyToken, password, confirmPassword } = req.body;

    if (!verifyToken) {
      return res.status(400).json({
        success: false,
        error: 'Verification session expired or unverified.',
        message: 'Verification session expired or unverified.'
      });
    }

    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters in length.',
        message: 'Password must be at least 6 characters in length.'
      });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match. Please verify both fields.',
        message: 'Passwords do not match. Please verify both fields.'
      });
    }

    const cleanToken = String(verifyToken).trim();
    const record = await Verification.findOne({
      verifyToken: cleanToken,
      verified: true
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'Verification session expired or unverified.',
        message: 'Verification session expired or unverified.'
      });
    }

    // Generate unique Team ID
    const generatedTeamId = await generateUniqueTeamId(record.teamName);
    const cleanPassword = String(password).trim();

    // Create official Team in MongoDB (password will be hashed by pre-save hook)
    const team = new Team({
      team_id: generatedTeamId,
      team_name: record.teamName,
      admin_name: record.adminName,
      admin_email: record.email,
      phone_number: record.phone,
      password: cleanPassword
    });

    await team.save();

    // Send WhatsApp credentials
    try {
      await sendNewTeamRegistrationWhatsApp({
        recipientPhone: record.phone,
        teamName: record.teamName,
        teamId: generatedTeamId,
        adminName: record.adminName,
        password: cleanPassword
      });
    } catch (waErr) {
      console.warn('⚠️ Could not dispatch WhatsApp credentials:', waErr.message);
    }

    // Send email credentials if non-placeholder
    if (record.email && !record.email.endsWith('@cricpass.lk')) {
      try {
        await sendTeamCredentialsEmail({
          recipientEmail: record.email,
          teamId: generatedTeamId,
          teamName: record.teamName,
          password: cleanPassword
        });
      } catch (mailErr) {
        console.warn('⚠️ Could not dispatch email credentials:', mailErr.message);
      }
    }

    // Delete temporary verification record
    await Verification.deleteOne({ _id: record._id });

    return res.status(200).json({
      success: true,
      teamId: generatedTeamId,
      teamName: record.teamName
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Two-step OTP flow for team admin phone number change
 *          Step 1: Request OTP for old phone number
 *          Step 2: Verify old phone OTP -> Triggers OTP to new phone number
 *          Step 3: Verify new phone OTP -> Updates database
 * @route   PUT /api/teams/update-phone
 * @access  Public
 */
async function updateTeamPhone(req, res, next) {
  try {
    const {
      team_id,
      new_phone_number,
      old_phone_otp,
      new_phone_otp,
      step
    } = req.body;

    if (!team_id) {
      return res.status(400).json({ success: false, message: 'team_id is required' });
    }

    const team = await resolveTeam(team_id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: `Team '${team_id}' not found.`
      });
    }

    const normalizedStep = step ? String(step).trim().toUpperCase() : null;

    // -------------------------------------------------------------
    // STEP 1: INITIATE / REQUEST OTP TO CURRENT PHONE NUMBER
    // -------------------------------------------------------------
    const isStep1 =
      normalizedStep === 'INITIATE' ||
      normalizedStep === 'REQUEST_OLD_OTP' ||
      (new_phone_number && !old_phone_otp && !new_phone_otp);

    if (isStep1) {
      if (!new_phone_number || !new_phone_number.trim()) {
        return res.status(400).json({
          success: false,
          message: 'new_phone_number is required to initiate phone update'
        });
      }

      const trimmedNewPhone = new_phone_number.trim();
      if (trimmedNewPhone === team.phone_number) {
        return res.status(400).json({
          success: false,
          message: 'New phone number cannot be identical to current phone number'
        });
      }

      // Generate OTP for existing phone number
      const oldOtp = generateOTP(6);

      // Clean up previous active session for this team if any
      await PhoneUpdateSession.deleteMany({ team_id: team._id });

      const session = new PhoneUpdateSession({
        team_id: team._id,
        old_phone_number: team.phone_number,
        new_phone_number: trimmedNewPhone,
        old_phone_otp: oldOtp,
        old_otp_verified: false,
        new_phone_otp: null,
        new_otp_verified: false,
        status: 'PENDING_OLD_VERIFICATION'
      });

      await session.save();

      // Dispatch simulated SMS to old phone
      sendSimulatedSMS(
        team.phone_number,
        `[CricPass] OTP to authorize phone number update for team ${team.team_name}: ${oldOtp}. Valid for 10 minutes.`
      );

      return res.status(200).json({
        success: true,
        step: 'OLD_OTP_SENT',
        message: `Step 1 of 2: OTP sent to current admin phone number (${team.phone_number}). Please verify old phone OTP.`,
        data: {
          team_id: team.team_id,
          current_phone_number: team.phone_number,
          new_phone_number: trimmedNewPhone,
          session_id: session._id,
          dev_old_phone_otp: oldOtp
        }
      });
    }

    // -------------------------------------------------------------
    // Find active session for subsequent steps
    // -------------------------------------------------------------
    const activeSession = await PhoneUpdateSession.findOne({
      team_id: team._id,
      status: { $in: ['PENDING_OLD_VERIFICATION', 'PENDING_NEW_VERIFICATION'] }
    }).sort({ createdAt: -1 });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active phone update session found. Please initiate the request with new_phone_number first.'
      });
    }

    // Check expiration
    if (activeSession.expires_at && new Date() > new Date(activeSession.expires_at)) {
      await PhoneUpdateSession.deleteOne({ _id: activeSession._id });
      return res.status(400).json({
        success: false,
        message: 'Phone update session expired. Please start over.'
      });
    }

    // -------------------------------------------------------------
    // ALL-IN-ONE SUBMISSION: Both old & new OTPs provided
    // -------------------------------------------------------------
    if (old_phone_otp && new_phone_otp) {
      if (String(old_phone_otp).trim() !== String(activeSession.old_phone_otp)) {
        return res.status(400).json({ success: false, message: 'Invalid old phone OTP' });
      }
      if (!activeSession.new_phone_otp || String(new_phone_otp).trim() !== String(activeSession.new_phone_otp)) {
        return res.status(400).json({ success: false, message: 'Invalid new phone OTP' });
      }

      team.phone_number = activeSession.new_phone_number;
      await team.save();
      await PhoneUpdateSession.deleteOne({ _id: activeSession._id });

      return res.status(200).json({
        success: true,
        step: 'COMPLETED',
        message: 'Team admin phone number updated successfully.',
        data: team
      });
    }

    // -------------------------------------------------------------
    // STEP 2: VERIFY OLD PHONE OTP
    // -------------------------------------------------------------
    const isStep2 =
      normalizedStep === 'VERIFY_OLD' ||
      (old_phone_otp && !new_phone_otp);

    if (isStep2) {
      if (String(old_phone_otp).trim() !== String(activeSession.old_phone_otp)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP for current phone number'
        });
      }

      const newOtp = generateOTP(6);

      activeSession.old_otp_verified = true;
      activeSession.new_phone_otp = newOtp;
      activeSession.status = 'PENDING_NEW_VERIFICATION';
      await activeSession.save();

      sendSimulatedSMS(
        activeSession.new_phone_number,
        `[CricPass] OTP to complete phone number verification for team ${team.team_name}: ${newOtp}. Valid for 10 minutes.`
      );

      return res.status(200).json({
        success: true,
        step: 'NEW_OTP_SENT',
        message: `Step 2 of 2: Old phone verified! OTP sent to new phone number (${activeSession.new_phone_number}). Please verify new phone OTP.`,
        data: {
          team_id: team.team_id,
          new_phone_number: activeSession.new_phone_number,
          session_id: activeSession._id,
          dev_new_phone_otp: newOtp
        }
      });
    }

    // -------------------------------------------------------------
    // STEP 3: VERIFY NEW PHONE OTP & COMMIT UPDATE
    // -------------------------------------------------------------
    const isStep3 =
      normalizedStep === 'VERIFY_NEW' ||
      Boolean(new_phone_otp);

    if (isStep3) {
      if (!activeSession.old_otp_verified) {
        return res.status(400).json({
          success: false,
          message: 'Old phone number OTP must be verified before verifying the new phone number.'
        });
      }

      if (!activeSession.new_phone_otp || String(new_phone_otp).trim() !== String(activeSession.new_phone_otp)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP for new phone number'
        });
      }

      const previousPhone = team.phone_number;
      team.phone_number = activeSession.new_phone_number;
      await team.save();

      activeSession.new_otp_verified = true;
      activeSession.status = 'COMPLETED';
      await activeSession.save();
      await PhoneUpdateSession.deleteOne({ _id: activeSession._id });

      sendSimulatedSMS(
        team.phone_number,
        `[CricPass] Phone number updated successfully for team ${team.team_name} from ${previousPhone} to ${team.phone_number}.`
      );

      try {
        await sendWhatsAppNumberChangedWhatsApp({
          recipientPhone: team.phone_number,
          teamId: team.team_id,
          teamName: team.team_name,
          password: 'Saved Account Password (Unchanged)'
        });
      } catch (waErr) {
        console.warn('⚠️ Could not dispatch WhatsApp number change message:', waErr.message);
      }

      return res.status(200).json({
        success: true,
        step: 'COMPLETED',
        message: 'Team admin phone number updated successfully.',
        data: team
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Invalid request parameters for phone update flow.'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get all teams with registered player counts
 * @route   GET /api/teams
 * @access  Public
 */
async function getAllTeams(req, res, next) {
  try {
    const teams = await Team.find().sort({ team_name: 1 });

    const teamsWithPlayerCounts = await Promise.all(
      teams.map(async (team) => {
        const playerCount = await Player.countDocuments({ current_team_id: team._id });
        return {
          ...team.toObject(),
          player_count: playerCount
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: teamsWithPlayerCounts.length,
      data: teamsWithPlayerCounts
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Get single team by ID or team_id with player roster
 * @route   GET /api/teams/:id
 * @access  Public
 */
async function getTeamById(req, res, next) {
  try {
    const { id } = req.params;
    const team = await resolveTeam(id);

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const players = await Player.find({ current_team_id: team._id }).sort({ full_name: 1 });

    return res.status(200).json({
      success: true,
      data: {
        team,
        player_count: players.length,
        players
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Look up registered team(s) by admin WhatsApp / phone number (for forgot-password flow)
 * @route   POST /api/teams/lookup-by-phone
 * @access  Public
 */
async function lookupTeamsByPhone(req, res, next) {
  try {
    const rawPhone = req.body.phone_number || req.body.phone;
    if (!rawPhone || !String(rawPhone).trim()) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp phone number is required'
      });
    }

    const variants = buildPhoneVariants(rawPhone);
    const teams = await Team.find({ phone_number: { $in: variants } })
      .select('team_id team_name admin_name phone_number')
      .sort({ team_name: 1 });

    if (!teams.length) {
      return res.status(404).json({
        success: false,
        message: `No registered club found with WhatsApp number ${formatDisplayPhone(rawPhone) || rawPhone}`
      });
    }

    return res.status(200).json({
      success: true,
      data: teams
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Change team admin password (after OTP verification)
 * @route   PUT /api/teams/change-password
 * @access  Public
 */
async function changeTeamPassword(req, res, next) {
  try {
    const { team_id, phone_number, new_password } = req.body;

    if ((!team_id && !phone_number) || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Team identifier (team_id or phone_number) and new_password are required'
      });
    }

    if (String(new_password).trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters long'
      });
    }

    let team = null;
    if (team_id) {
      team = await resolveTeam(team_id);
    }
    if (!team && phone_number) {
      const variants = buildPhoneVariants(phone_number);
      team = await Team.findOne({ phone_number: { $in: variants } });
    }
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    team.password = String(new_password).trim();
    await team.save();

    // Send WhatsApp notification for password change
    try {
      await sendPasswordChangedWhatsApp({
        recipientPhone: team.phone_number,
        teamName: team.team_name,
        teamId: team.team_id,
        newPassword: String(new_password).trim()
      });
    } catch (waErr) {
      console.warn('⚠️ Could not dispatch password change WhatsApp notification:', waErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Admin password updated successfully in database!',
      data: {
        team_id: team.team_id,
        team_name: team.team_name
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Initiate new phone verification for logged-in Team Admin
 * @route   POST /api/teams/initiate-phone-change
 * @access  Public
 */
async function initiatePhoneChange(req, res, next) {
  try {
    const { team_id, new_phone } = req.body;

    if (!team_id || !new_phone) {
      return res.status(400).json({
        success: false,
        message: 'Both team_id and new_phone are required.'
      });
    }

    const team = await resolveTeam(team_id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: `Team '${team_id}' not found.`
      });
    }

    const formattedPhone = formatDisplayPhone(new_phone);
    if (!/^\+94[1-9]\d{8}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp number must be +94 followed by 9 digits without a leading 0 (e.g. +94770000000).'
      });
    }

    if (team.phone_number === formattedPhone) {
      return res.status(400).json({
        success: false,
        message: 'New WhatsApp number cannot be identical to your current WhatsApp number.'
      });
    }

    // Check if new phone is already registered to another team
    const existingTeam = await Team.findOne({
      phone_number: formattedPhone,
      _id: { $ne: team._id }
    });

    if (existingTeam) {
      return res.status(409).json({
        success: false,
        message: `WhatsApp number ${formattedPhone} is already registered to another team.`
      });
    }

    // Call startTeamAdminVerification
    const verificationResult = await startTeamAdminVerification({
      adminName: team.admin_name || 'Team Administrator',
      teamName: team.team_name,
      phone: formattedPhone,
      email: team.admin_email,
      purpose: 'Change Admin WhatsApp Number'
    });

    return res.status(200).json({
      success: true,
      method: verificationResult.method,
      verifyToken: verificationResult.verifyToken,
      message: `Verification initiated for ${formattedPhone}.`
    });
  } catch (error) {
    next(error);
  }
}

/**
 * @desc    Change team admin email address / WhatsApp number (after dual OTP verification)
 * @route   PUT /api/teams/change-email
 * @access  Public
 */
async function changeTeamEmail(req, res, next) {
  try {
    const { team_id, new_email, new_phone, new_password, verifyToken } = req.body;
    const rawContact = new_phone || new_email;

    if (!team_id || !rawContact) {
      return res.status(400).json({
        success: false,
        message: 'Both team_id and new WhatsApp phone number / contact are required'
      });
    }

    const team = await resolveTeam(team_id);
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // If verifyToken was supplied, ensure that OTP was verified
    if (verifyToken) {
      const vRecord = await Verification.findOne({
        verifyToken: String(verifyToken).trim(),
        verified: true
      });
      if (!vRecord) {
        return res.status(400).json({
          success: false,
          message: 'Verification session expired or OTP has not been verified.'
        });
      }
    }

    const rawStr = String(rawContact).trim();
    const isEmailInput = rawStr.includes('@');

    if (isEmailInput) {
      const cleanEmail = rawStr.toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address format'
        });
      }
      team.admin_email = cleanEmail;
    } else {
      const formattedPhone = formatDisplayPhone(rawStr);
      if (!/^\+94[1-9]\d{8}$/.test(formattedPhone)) {
        return res.status(400).json({
          success: false,
          message: 'WhatsApp number must be +94 followed by 9 digits without a leading 0 (e.g. +94770000000)'
        });
      }
      team.phone_number = formattedPhone;
      if (!team.admin_email || team.admin_email.endsWith('@cricpass.lk')) {
        team.admin_email = `${formattedPhone.replace(/\D/g, '')}@cricpass.lk`;
      }
    }

    if (new_password && String(new_password).trim()) {
      if (String(new_password).trim().length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters in length'
        });
      }
      team.password = String(new_password).trim();
    }
    await team.save();

    const displayPassword =
      new_password && String(new_password).trim()
        ? String(new_password).trim()
        : 'Unchanged (Current Password)';

    if (isEmailInput) {
      try {
        await sendTeamCredentialsEmail({
          recipientEmail: team.admin_email,
          teamId: team.team_id,
          teamName: team.team_name,
          password: displayPassword
        });
      } catch (mailErr) {
        console.warn('⚠️ Could not dispatch new credentials email:', mailErr.message);
      }
    } else {
      try {
        await sendWhatsAppNumberChangedWhatsApp({
          recipientPhone: team.phone_number,
          teamId: team.team_id,
          teamName: team.team_name,
          password: displayPassword
        });
      } catch (waErr) {
        console.warn('⚠️ Could not dispatch new credentials WhatsApp:', waErr.message);
      }
    }

    const teamObj = team.toObject();
    delete teamObj.password;

    return res.status(200).json({
      success: true,
      message: isEmailInput
        ? `Admin email updated to ${team.admin_email}. Official credentials dispatched.`
        : `Admin WhatsApp updated to ${team.phone_number}. Official credentials dispatched via WhatsApp.`,
      data: teamObj
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  loginTeamAdmin,
  registerTeam,
  verifyTeamOtp,
  completeTeamRegistration,
  initiatePhoneChange,
  updateTeamPhone,
  getAllTeams,
  getTeamById,
  lookupTeamsByPhone,
  changeTeamPassword,
  changeTeamEmail
};