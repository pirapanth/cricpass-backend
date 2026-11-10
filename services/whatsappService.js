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
  if (cleaned.startsWith('0')) {
    cleaned = defaultCountryCode + cleaned.substring(1);
  } else if (cleaned.length === 9) {
    cleaned = defaultCountryCode + cleaned;
  }
  return cleaned;
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

  if (sock && isReady) {
    try {
      const response = await sock.sendMessage(jid, { text: messageText });
      console.log(`✅ [WhatsApp] OTP delivered successfully to ${jid}`);
      return { success: true, phone: cleanPhone, messageId: response?.key?.id };
    } catch (err) {
      console.error(`❌ [WhatsApp] Failed to send message:`, err.message);
      throw new Error(`WhatsApp delivery failed: ${err.message}`);
    }
  } else {
    console.warn(`⚠️ [WhatsApp] Client not connected yet. Simulated OTP: ${otpCode}`);
    return { success: true, simulated: true, phone: cleanPhone, otpCode };
  }
}

module.exports = {
  initializeWhatsAppClient,
  sendWhatsAppOTP,
  formatPhoneNumber,
  isWhatsAppReady: () => isReady
};