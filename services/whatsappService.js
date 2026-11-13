const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');

let sock = null;
let isReady = false;

// Stores pending user-initiated verifications:
// { "VERIFY-4829": { otp: "654321", teamName: "USSC", purpose: "Team Registration", expiresAt: 1731490000000 } }
const pendingVerifications = new Map();

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
 * Silently save Team Admin into Google Contacts via Apps Script (v70524817@gmail.com)
 */
async function saveContactToGoogle({ adminName, teamName, phone }) {
  const webhookUrl = process.env.GMAIL_WEBHOOK_URL?.trim();
  const displayPhone = formatDisplayPhone(phone);
  if (!webhookUrl || !displayPhone) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveContact',
        name: `${adminName || 'Team Admin'} - ${teamName || 'CricPass'}`,
        teamName: teamName || 'CricPass Club',
        phone: displayPhone
      })
    });
    console.log(`📇 [Contacts] Saved ${displayPhone} to Google Contacts`);
  } catch (err) {
    console.warn('⚠️ [Contacts] Failed to sync Google Contact:', err.message);
  }
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
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n=============================================================');
        console.log('📲 CRICPASS WHATSAPP AUTHENTICATION QR CODE');
        console.log('=============================================================\n');
        qrcodeTerminal.generate(qr, { small: true });

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
        console.log('🚀 [WhatsApp] Baileys client is connected and READY!');
      } else if (connection === 'close') {
        isReady = false;
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.warn('⚠️ [WhatsApp] Connection closed. Reconnecting...', shouldReconnect);
        if (shouldReconnect) {
          initializeWhatsAppClient();
        }
      }
    });

    // Listen for incoming "VERIFY-XXXX" messages from Team Admins (Zero Ban Risk)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid; // Works for both @s.whatsapp.net and @lid
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        const incomingCode = text.trim().toUpperCase();
        const record = pendingVerifications.get(incomingCode);

        if (record && Date.now() < record.expiresAt) {
          const replyText =
`🏏 *CricPass Official Verification*
━━━━━━━━━━━━━━━━━━━━━━
An authorization request was initiated for:
*${record.purpose}* (${record.teamName})

Your 6-Digit One-Time Password (OTP) is:
👉 *${record.otp}*

⏰ This code is valid for *5 minutes*.
🔒 For your security, do not share this code with anyone.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

          await sock.sendMessage(senderJid, { text: replyText }, { quoted: msg });
          console.log(`✅ [WhatsApp] Replied with OTP to ${senderJid} for token ${incomingCode}`);
          pendingVerifications.delete(incomingCode);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('❌ [WhatsApp] Baileys initialization error:', error.message);
  }
}

/**
 * Smart Hybrid Verification (WhatsApp First-Message + Google Contact Save + Email Fallback)
 */
async function startTeamAdminVerification({ adminName, teamName, phone, email, purpose = 'Team Verification' }) {
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const webhookUrl = process.env.GMAIL_WEBHOOK_URL?.trim();

  // Purge expired verification tokens from memory
  const now = Date.now();
  for (const [key, val] of pendingVerifications.entries()) {
    if (now >= val.expiresAt) pendingVerifications.delete(key);
  }

  // 1. Save Team Admin number into Google Contacts in the background
  if (phone) {
    saveContactToGoogle({ adminName, teamName, phone });
  }

  // 2. If Baileys WhatsApp is connected, return token for user-initiated wa.me chat
  if (isReady && sock) {
    const verifyToken = `VERIFY-${Math.floor(1000 + Math.random() * 9000)}`;
    pendingVerifications.set(verifyToken, {
      otp: otpCode,
      teamName: teamName || 'CricPass Club',
      purpose,
      expiresAt: now + 10 * 60 * 1000 // Valid 10 minutes
    });

    return {
      success: true,
      method: 'whatsapp',
      verifyToken,
      otpCode
    };
  }

  // 3. Automatic Email Fallback if Render just woke up from sleep and Baileys is reconnecting
  if (webhookUrl && email) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: `CricPass Verification OTP - ${teamName || 'Team Admin'}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 16px;">
            <h2>🏏 CricPass Official Verification</h2>
            <p>Your 6-digit verification code for <b>${teamName || 'your team'}</b> (${purpose}) is:</p>
            <h1 style="letter-spacing: 4px; color: #16a34a;">${otpCode}</h1>
            <p>This code is valid for 5 minutes.</p>
          </div>
        `
      })
    });

    return {
      success: true,
      method: 'email',
      otpCode
    };
  }

  throw new Error('WhatsApp is reconnecting and no fallback email was provided.');
}

/**
 * Send 6-digit WhatsApp OTP verification message (Direct Outbound)
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

  const currentTeamMsg =
`${header}
━━━━━━━━━━━━━━━━━━━━━━
*Player's Full Name:* ${playerName}
*NIC Number :* ${nicNumber}
*Contact Phone Number:* ${playerPhone}

The Player sucessfully Transfer the ${newTeamName || 'Destination Team'} ....! , The Player Will can play after ${coolingOffText}
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Official Transfer Protocol_`;

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
  startTeamAdminVerification,
  saveContactToGoogle,
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