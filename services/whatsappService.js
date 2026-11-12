const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const mongoose = require('mongoose');

let sock = null;
let isReady = false;

/**
 * Format phone number into international digit string (e.g., Sri Lanka +94)
 */
function formatPhoneNumber(rawPhone, defaultCountryCode = '94') {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/\D/g, '');
  if (cleaned.startsWith('940') && cleaned.length === 12) {
    cleaned = defaultCountryCode + cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    cleaned = defaultCountryCode + cleaned.substring(1);
  } else if (cleaned.length === 9) {
    cleaned = defaultCountryCode + cleaned;
  }
  return cleaned;
}

/**
 * Format phone number into "+94XXXXXXXXX" display format
 */
function formatDisplayPhone(rawPhone, defaultCountryCode = '94') {
  const digits = formatPhoneNumber(rawPhone, defaultCountryCode);
  return digits ? `+${digits}` : '';
}

/**
 * Initialize Baileys WhatsApp Connection (No Chrome/Puppeteer required)
 */
async function initializeWhatsAppClient() {
  try {
    console.log('📱 [WhatsApp] Initializing Baileys pure-socket client...');
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // Handled manually below for crisp rendering
      logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n=============================================================');
        console.log('📲 CRICPASS WHATSAPP AUTHENTICATION QR CODE');
        console.log('=============================================================\n');
        
        // 1. Render terminal ASCII QR backup
        qrcodeTerminal.generate(qr, { small: true });

        // 2. Generate browser-scannable Data URL
        try {
          const qrImageUrl = await QRCode.toDataURL(qr);
          console.log('\n🔗 COPY THIS URL & PASTE IN YOUR BROWSER FOR A CRISP QR CODE:');
          console.log(qrImageUrl);
          console.log('\n=============================================================\n');
        } catch (err) {
          console.error('⚠️ [WhatsApp] Failed to generate browser QR image:', err.message);
        }
      }

      if (connection === 'open') {
        isReady = true;
        console.log('🚀 [WhatsApp] Baileys client is connected and READY to send OTP messages!');
      } else if (connection === 'close') {
        isReady = false;
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.warn('⚠️ [WhatsApp] Connection closed. Reconnecting...', shouldReconnect);
        if (shouldReconnect) {
          initializeWhatsAppClient();
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error('❌ [WhatsApp] Baileys initialization error:', error.message);
  }
}

/**
 * Send 6-digit WhatsApp OTP verification message
 */
/**
 * Send 6-digit WhatsApp OTP verification message
 */
async function sendWhatsAppOTP(phoneNumber, otpCode, purpose = 'Verification') {
  if (!phoneNumber) {
    throw new Error('Recipient phone number is required');
  }

  const cleanPhone = formatPhoneNumber(phoneNumber);
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error(`Invalid phone number format: "${phoneNumber}".`);
  }

  const jid = `${cleanPhone}@s.whatsapp.net`;

  const messageText = 
`🏏 *CricPass Official Verification*
━━━━━━━━━━━━━━━━━━━━━━
An authorization request was initiated for:
*${purpose}*

Your 6-Digit One-Time Password (OTP) is:
👉 *${otpCode}*

⏰ This code is valid for *5 minutes*.
🔒 For your security, do not share this code with anyone.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

  console.log(`📱 [WhatsApp] Attempting to send OTP to JID: ${jid} (Ready: ${isReady}, Socket exists: ${!!sock})`);

  if (sock) {
    try {
      // Optional number lookup to guarantee Baileys routes to the exact correct JID format
      let targetJid = jid;
      try {
        const [result] = await sock.onWhatsApp(cleanPhone);
        if (result && result.exists) {
          targetJid = result.jid;
        }
      } catch (lookupErr) {
        console.warn('⚠️ [WhatsApp] onWhatsApp check skipped/failed, using standard jid:', lookupErr.message);
      }

      const response = await sock.sendMessage(targetJid, { text: messageText });
      console.log(`✅ [WhatsApp] OTP successfully delivered to ${targetJid} (ID: ${response?.key?.id})`);
      return { success: true, phone: cleanPhone, messageId: response?.key?.id };
    } catch (err) {
      console.error(`❌ [WhatsApp] Failed to deliver message to ${jid}:`, err.message);
      throw new Error(`WhatsApp delivery failed: ${err.message}`);
    }
  } else {
    console.warn(`⚠️ [WhatsApp] Socket not initialized. Simulated OTP: ${otpCode}`);
    return { success: true, simulated: true, phone: cleanPhone, otpCode };
  }
}

/**
 * Send a generic formatted message via WhatsApp
 */
async function sendGenericWhatsAppMessage(rawPhone, messageText) {
  if (!rawPhone) return null;
  const cleanPhone = formatPhoneNumber(rawPhone);
  if (!cleanPhone || cleanPhone.length < 8) return null;

  const jid = `${cleanPhone}@s.whatsapp.net`;
  console.log(`📱 [WhatsApp] Dispatching message to: ${jid}`);

  if (sock) {
    try {
      let targetJid = jid;
      try {
        if (typeof sock.onWhatsApp === 'function') {
          const [result] = await sock.onWhatsApp(cleanPhone);
          if (result && result.exists) {
            targetJid = result.jid;
          }
        }
      } catch (lookupErr) {
        // Fall back to direct jid
      }

      const response = await sock.sendMessage(targetJid, { text: messageText });
      console.log(`✅ [WhatsApp] Message successfully delivered to ${targetJid} (ID: ${response?.key?.id})`);
      return { success: true, phone: cleanPhone, messageId: response?.key?.id };
    } catch (err) {
      console.error(`❌ [WhatsApp] Failed to deliver message to ${jid}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    console.warn(`⚠️ [WhatsApp] Socket not connected. Simulated dispatch to +${cleanPhone}:\n${messageText}`);
    return { success: true, simulated: true, phone: cleanPhone };
  }
}

/**
 * 1. Send credentials when a new team is registered
 */
async function sendNewTeamRegistrationWhatsApp({ recipientPhone, teamName, teamId, adminName, password }) {
  const messageText =
`🏏 *CricPass Team Registration*
━━━━━━━━━━━━━━━━━━━━━━
*Team Name:* ${teamName}
*Team Id:* ${teamId}
*Admin Full Name :* ${adminName || 'Team Administrator'}
*Admin Password :* ${password}

🔒 *Security Notice:* Please store your Team ID, Team Name / Username, and Password safely. Do not share your login credentials with unauthorized individuals.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

  return await sendGenericWhatsAppMessage(recipientPhone, messageText);
}

/**
 * 2.i. Send notification when team admin password is changed
 */
async function sendPasswordChangedWhatsApp({ recipientPhone, teamName, teamId, newPassword }) {
  const messageText =
`🏏 *CricPass Password Update*
━━━━━━━━━━━━━━━━━━━━━━
*Team Name:* ${teamName}
*Team Id:* ${teamId}
*New Password:* ${newPassword}

🔒 *Security Notice:* Please store your Team ID, Team Name / Username, and Password safely. Do not share your login credentials with unauthorized individuals.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

  return await sendGenericWhatsAppMessage(recipientPhone, messageText);
}

/**
 * 2.ii. Send notification to the new WhatsApp number when admin WhatsApp number is updated
 */
async function sendWhatsAppNumberChangedWhatsApp({ recipientPhone, teamName, teamId, password }) {
  const messageText =
`🏏 *CricPass WhatsApp Contact Update*
━━━━━━━━━━━━━━━━━━━━━━
*Team Name:* ${teamName}
*Team Id:* ${teamId}
*Password:* ${password}

🔒 *Security Notice:* Please store your Team ID, Team Name / Username, and Password safely. Do not share your login credentials with unauthorized individuals.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

  return await sendGenericWhatsAppMessage(recipientPhone, messageText);
}

/**
 * 3. Send notification to team admin when a new player is registered under their team
 */
async function sendPlayerRegisteredWhatsApp({ recipientPhone, playerName, nicNumber, playerPhone, teamName }) {
  const messageText =
`🏏 *New Player Registration*
━━━━━━━━━━━━━━━━━━━━━━
*Player's Full Name:* ${playerName}
*NIC Number :* ${nicNumber}
*Contact Phone Number:* ${playerPhone}
━━━━━━━━━━━━━━━━━━━━━━
_Club: ${teamName || 'Assigned Club'}_
_CricPass Cricket Registry & Transfer Protocol_`;

  return await sendGenericWhatsAppMessage(recipientPhone, messageText);
}

/**
 * 4. Send transfer completion notifications to current releasing team and destination receiving team
 */
async function sendTransferCompletedWhatsApp({
  currentTeamPhone,
  newTeamPhone,
  playerName,
  nicNumber,
  playerPhone,
  currentTeamName,
  newTeamName,
  coolingDays,
  isMutualClearance = false
}) {
  const coolingOffText =
    Number(coolingDays) === 14
      ? '14-Day (2 Weeks) cooling-off period'
      : '30-Day (1 Month) cooling-off cooldown';

  const header = isMutualClearance
    ? '🏏 *Mutual Clearance - Transfer Update*'
    : '🏏 *Player Transfer Completed*';

  // Current releasing team admin message
  const currentTeamMsg =
`${header}
━━━━━━━━━━━━━━━━━━━━━━
*Player's Full Name:* ${playerName}
*NIC Number :* ${nicNumber}
*Contact Phone Number:* ${playerPhone}

The Player sucessfully Transfer the ${newTeamName || 'Destination Team'} ....! , The Player Will can play after ${coolingOffText}
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Official Transfer Protocol_`;

  // Destination receiving team admin message
  const newTeamMsg =
`${header}
━━━━━━━━━━━━━━━━━━━━━━
*Player's Full Name:* ${playerName}
*NIC Number :* ${nicNumber}
*Contact Phone Number:* ${playerPhone}

The Player sucessfully Transfer from ${currentTeamName || 'Previous Team'} ....! , The Player Will can play after ${coolingOffText}
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Official Transfer Protocol_`;

  const results = {};
  if (currentTeamPhone) {
    try {
      results.currentTeam = await sendGenericWhatsAppMessage(currentTeamPhone, currentTeamMsg);
    } catch (err) {
      console.warn('⚠️ [WhatsApp] Failed to notify current team admin:', err.message);
    }
  }

  if (newTeamPhone) {
    try {
      results.newTeam = await sendGenericWhatsAppMessage(newTeamPhone, newTeamMsg);
    } catch (err) {
      console.warn('⚠️ [WhatsApp] Failed to notify receiving team admin:', err.message);
    }
  }

  return results;
}

/**
 * Backwards-compatible alias for team credentials
 */
async function sendTeamCredentialsWhatsApp({ recipientPhone, teamId, teamName, adminName, password }) {
  return await sendNewTeamRegistrationWhatsApp({ recipientPhone, teamId, teamName, adminName, password });
}

module.exports = {
  initializeWhatsAppClient,
  sendWhatsAppOTP,
  sendGenericWhatsAppMessage,
  sendNewTeamRegistrationWhatsApp,
  sendPasswordChangedWhatsApp,
  sendWhatsAppNumberChangedWhatsApp,
  sendPlayerRegisteredWhatsApp,
  sendTransferCompletedWhatsApp,
  sendTeamCredentialsWhatsApp,
  formatPhoneNumber,
  formatDisplayPhone,
  isWhatsAppReady: () => isReady
};