const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const Verification = require('../models/Verification');
const fs = require('fs');
const path = require('path');

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
 * Initialize Baileys WhatsApp Connection with Local Multi-File Auth State
 */
async function initializeWhatsAppClient() {
  try {
    console.log('📱 [WhatsApp] Initializing Baileys with local multi-file auth state...');
    
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    let version;
    try {
      const fetched = await fetchLatestBaileysVersion();
      version = fetched.version;
    } catch {
      version = [2, 3000, 1015901307];
    }

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      syncFullHistory: false
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
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        console.warn(`⚠️ [WhatsApp] Connection closed (Status: ${statusCode}).`);

        if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
          console.log('🔄 [WhatsApp] Clearing stale session files...');
          try {
            const authPath = path.join(__dirname, '../auth_info_baileys');
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
            }
          } catch (err) {
            console.warn('⚠️ [WhatsApp] Could not clear auth folder:', err.message);
          }
          setTimeout(() => initializeWhatsAppClient(), 3000);
        } else {
          console.log('🔄 [WhatsApp] Reconnecting in 5 seconds...');
          setTimeout(() => initializeWhatsAppClient(), 5000);
        }
      }
    });

    // Listen for incoming VERIFY-XXXX messages from Team Admins (Inbound Verification)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast' || senderJid.endsWith('@broadcast')) {
          continue;
        }

        // Extract text across all Baileys message structures (including ephemeral/viewOnce)
        const unwrap =
          msg.message.ephemeralMessage?.message ||
          msg.message.viewOnceMessage?.message ||
          msg.message.viewOnceMessageV2?.message ||
          msg.message;

        const text =
          unwrap.conversation ||
          unwrap.extendedTextMessage?.text ||
          unwrap.imageMessage?.caption ||
          unwrap.videoMessage?.caption ||
          unwrap.documentMessage?.caption ||
          '';

        const tokenMatch = text.toUpperCase().match(/VERIFY-[A-Z0-9]+/);
        if (!tokenMatch) continue;
        const incomingCode = tokenMatch[0];

        // Extract clean sender phone number for logging and cross-device correlation
        // Format: 94728989748@s.whatsapp.net or 94728989748:1@s.whatsapp.net
        const cleanSenderNumber = senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        console.log(`📩 [WhatsApp Inbound] Received code "${incomingCode}" from sender: ${cleanSenderNumber} (${senderJid})`);

        try {
          // Look up active verification session in MongoDB by verifyToken
          const record = await Verification.findOne({ verifyToken: incomingCode });

          if (!record) {
            console.warn(`⚠️ [WhatsApp Inbound] No session found for token "${incomingCode}" from ${cleanSenderNumber}`);
            await sock.sendMessage(senderJid, {
              text: `⚠️ *CricPass Verification Notice*\n━━━━━━━━━━━━━━━━━━━━━━\nWe could not find an active verification session for code *${incomingCode}*.\n\nPlease check the code or generate a new one on the CricPass website.`
            }, { quoted: msg });
            continue;
          }

          if (new Date() >= record.expiresAt) {
            console.warn(`⚠️ [WhatsApp Inbound] Token "${incomingCode}" has expired (expired at ${record.expiresAt})`);
            await sock.sendMessage(senderJid, {
              text: `⚠️ *CricPass Verification Notice*\n━━━━━━━━━━━━━━━━━━━━━━\nThe verification code *${incomingCode}* has expired.\n\nPlease request a fresh verification code on the CricPass website.`
            }, { quoted: msg });
            continue;
          }

          // Cross-device / Phone Number correlation:
          // The admin may be registering from a computer and sending from personal WhatsApp (e.g. 0728989748)
          const recordDigits = (record.phone || '').replace(/\D/g, '');
          const phoneMatches =
            recordDigits &&
            (cleanSenderNumber.endsWith(recordDigits.slice(-9)) ||
             recordDigits.endsWith(cleanSenderNumber.slice(-9)));

          if (phoneMatches) {
            console.log(`📱 [WhatsApp Inbound] Phone matched registered number (${record.phone}) for token ${incomingCode}`);
          } else {
            console.log(`📱 [WhatsApp Inbound] Cross-device token match: Sender ${cleanSenderNumber}, Registered ${record.phone || 'N/A'}`);
          }

          const replyText =
`🏏 *CricPass Official Verification*
━━━━━━━━━━━━━━━━━━━━━━
An authorization request was initiated for:
*${record.purpose || 'Team Registration'}* (${record.teamName})

Your 6-Digit One-Time Password (OTP) is:
👉 *${record.otp}*

⏰ This code is valid for *10 minutes*.
🔒 Enter this code on the website to complete your verification.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Cricket Registry & Transfer Protocol_`;

          await sock.sendMessage(senderJid, { text: replyText }, { quoted: msg });
          console.log(`✅ [WhatsApp Inbound] Successfully replied with OTP to ${senderJid} for token ${incomingCode}`);
        } catch (dbErr) {
          console.error(`❌ [WhatsApp Inbound] Error handling verification token ${incomingCode}:`, dbErr.message);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('❌ [WhatsApp] Baileys initialization error:', error.message);
  }
}

/**
 * Step 1: Start Team Admin Verification (Saves token & OTP to MongoDB Verification collection)
 * STRICT OUTBOUND RULE:
 * The backend does NOT send any automatic outbound WhatsApp messages.
 * The verification is strictly user-initiated: user clicks "Send Verify Code via WhatsApp"
 * to send the VERIFY-XXXX code to the bot, and the bot replies with the 6-digit OTP.
 */
async function startTeamAdminVerification({ adminName, teamName, phone, email, purpose = 'Team Registration' }) {
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const verifyToken = `VERIFY-${Math.floor(1000 + Math.random() * 9000)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Valid 10 minutes

  // 1. Save Team Admin number into Google Contacts in the background if configured
  if (phone) {
    saveContactToGoogle({ adminName, teamName, phone });
  }

  // 2. Store verification session in MongoDB
  await Verification.create({
    verifyToken,
    otp: otpCode,
    teamName: teamName || 'CricPass Club',
    adminName: adminName || 'Team Administrator',
    phone,
    email,
    purpose,
    verified: false,
    expiresAt
  });

  console.log(`🔐 [Verification] Created session for "${teamName}" (${phone || 'No phone'}). Token: ${verifyToken}, OTP: ${otpCode}. Awaiting user-initiated inbound message.`);

  // 3. Return verification token for user-initiated wa.me message to bot
  return {
    success: true,
    method: 'whatsapp',
    verifyToken
  };
}

/**
 * Send 6-digit WhatsApp OTP verification message (Direct Outbound)
 */
async function sendWhatsAppOTP(phoneNumber, otpCode, purpose = 'Verification') {
  if (!phoneNumber) throw new Error('Recipient phone number is required');

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

  if (sock && isReady) {
    try {
      let targetJid = jid;
      try {
        const [result] = await sock.onWhatsApp(cleanPhone);
        if (result && result.exists) targetJid = result.jid;
      } catch (lookupErr) {}

      const response = await sock.sendMessage(targetJid, { text: messageText });
      return { success: true, phone: cleanPhone, messageId: response?.key?.id };
    } catch (err) {
      throw new Error(`WhatsApp delivery failed: ${err.message}`);
    }
  } else {
    throw new Error('WhatsApp client is not connected or ready.');
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

  if (sock && isReady) {
    try {
      let targetJid = jid;
      try {
        if (typeof sock.onWhatsApp === 'function') {
          const [result] = await sock.onWhatsApp(cleanPhone);
          if (result && result.exists) targetJid = result.jid;
        }
      } catch (lookupErr) {}

      const response = await sock.sendMessage(targetJid, { text: messageText });
      return { success: true, phone: cleanPhone, messageId: response?.key?.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  } else {
    return { success: false, error: 'WhatsApp not connected' };
  }
}

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

The Player successfully transferred to ${newTeamName || 'Destination Team'}! The player will be able to play after ${coolingOffText}.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Official Transfer Protocol_`;

  const newTeamMsg =
`${header}
━━━━━━━━━━━━━━━━━━━━━━
*Player's Full Name:* ${playerName}
*NIC Number :* ${nicNumber}
*Contact Phone Number:* ${playerPhone}

The Player successfully transferred from ${currentTeamName || 'Previous Team'}! The player will be able to play after ${coolingOffText}.
━━━━━━━━━━━━━━━━━━━━━━
_CricPass Official Transfer Protocol_`;

  const results = {};
  if (currentTeamPhone) {
    try {
      results.currentTeam = await sendGenericWhatsAppMessage(currentTeamPhone, currentTeamMsg);
    } catch (err) {}
  }

  if (newTeamPhone) {
    try {
      results.newTeam = await sendGenericWhatsAppMessage(newTeamPhone, newTeamMsg);
    } catch (err) {}
  }

  return results;
}

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