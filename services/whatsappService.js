const { Client, RemoteAuth, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mongoose = require('mongoose');

let MongoStore;
try {
  MongoStore = require('wwebjs-mongo').MongoStore;
} catch (err) {
  console.warn('⚠️ [WhatsApp] wwebjs-mongo module not loaded yet:', err.message);
}

let client = null;
let isReady = false;
let isInitializing = false;

/**
 * Format any phone number into international digit string (defaults to Sri Lanka +94)
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
 * Convert clean phone number to WhatsApp Chat ID (e.g., "94771234567@c.us")
 */
function getWhatsAppChatId(phone) {
  const formatted = formatPhoneNumber(phone);
  return `${formatted}@c.us`;
}

/**
 * Initialize WhatsApp Web Client with RemoteAuth (MongoDB) or LocalAuth fallback
 */
async function initializeWhatsAppClient() {
  if (client || isInitializing) return client;
  isInitializing = true;

  try {
    let authStrategy;

    // Use RemoteAuth with wwebjs-mongo if Mongo is connected
    if (MongoStore && mongoose.connection.readyState === 1) {
      try {
        console.log('📱 [WhatsApp] Initializing RemoteAuth with MongoDB session store...');
        const store = new MongoStore({ mongoose: mongoose });
        authStrategy = new RemoteAuth({
          store: store,
          backupSyncIntervalMs: 300000 // 5 minutes backup sync
        });
      } catch (authErr) {
        console.warn('⚠️ [WhatsApp] RemoteAuth initialization failed, falling back to LocalAuth:', authErr.message);
        authStrategy = new LocalAuth({ clientId: 'cricpass-session', dataPath: './.wwebjs_auth' });
      }
    } else {
      console.log('📱 [WhatsApp] Using LocalAuth session strategy...');
      authStrategy = new LocalAuth({ clientId: 'cricpass-session', dataPath: './.wwebjs_auth' });
    }

    // Only set executablePath if the environment variable is explicitly defined
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    const puppeteerOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-infobars',
        '--window-size=1280,720'
      ]
    };

    if (executablePath) {
      puppeteerOptions.executablePath = executablePath;
    }

    client = new Client({
      authStrategy: authStrategy,
      puppeteer: puppeteerOptions
    });

    // QR Code generation in terminal
    client.on('qr', (qr) => {
      console.log('\n=============================================================');
      console.log('📲 CRICPASS WHATSAPP AUTHENTICATION QR CODE');
      console.log('Scan the QR code below using WhatsApp on your device:');
      console.log('=============================================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n=============================================================\n');
    });

    client.on('authenticated', () => {
      console.log('✅ [WhatsApp] WhatsApp Web client authenticated successfully.');
    });

    client.on('auth_failure', (msg) => {
      console.error('❌ [WhatsApp] Authentication failure:', msg);
    });

    client.on('ready', () => {
      isReady = true;
      console.log('🚀 [WhatsApp] WhatsApp Web client is READY to send OTP messages!');
    });

    client.on('disconnected', (reason) => {
      console.warn('⚠️ [WhatsApp] WhatsApp client was disconnected:', reason);
      isReady = false;
      client = null;
      isInitializing = false;
    });

    console.log('📱 [WhatsApp] Launching Chromium instance for WhatsApp Web...');
    client.initialize().catch((err) => {
      console.error('❌ [WhatsApp] Error during client.initialize():', err.message);
      isInitializing = false;
    });

    return client;
  } catch (error) {
    console.error('❌ [WhatsApp] Initialization error:', error.message);
    isInitializing = false;
    return null;
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
    throw new Error(`Invalid phone number format: "${phoneNumber}". Please include valid country code.`);
  }

  const chatId = `${cleanPhone}@c.us`;

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

  console.log(`📱 [WhatsApp] Dispatching OTP [${otpCode}] to ${chatId} (${purpose})...`);

  if (client && isReady) {
    try {
      const response = await client.sendMessage(chatId, messageText);
      console.log(`✅ [WhatsApp] OTP successfully delivered to ${chatId} (ID: ${response.id?._serialized || response.id?.id})`);
      return {
        success: true,
        phone: cleanPhone,
        chatId: chatId,
        messageId: response.id?._serialized || response.id?.id
      };
    } catch (sendErr) {
      console.error(`❌ [WhatsApp] Failed to deliver message to ${chatId}:`, sendErr.message);
      throw new Error(`WhatsApp delivery failed: ${sendErr.message}`);
    }
  } else {
    console.warn(`⚠️ [WhatsApp] Client is not ready yet (ready status: ${isReady}). OTP: ${otpCode} for ${cleanPhone}`);
    return {
      success: true,
      simulated: true,
      phone: cleanPhone,
      chatId: chatId,
      otpCode: otpCode,
      note: 'WhatsApp client is authenticating or connecting. Check console QR code if first run.'
    };
  }
}

/**
 * Send official team admin credentials via WhatsApp
 */
async function sendTeamCredentialsWhatsApp({ recipientPhone, teamId, teamName, password }) {
  if (!recipientPhone) return null;
  const cleanPhone = formatPhoneNumber(recipientPhone);
  const chatId = `${cleanPhone}@c.us`;

  const messageText = 
`🏏 *Welcome to CricPass Portal*
━━━━━━━━━━━━━━━━━━━━━━
Your team administrator credentials for *${teamName}*:

📋 *Team ID / Username:* \`${teamId}\`
🔑 *Password:* \`${password}\`
📱 *WhatsApp Contact:* \`${cleanPhone}\`

🌐 *Login Portal:* https://cricpass.vercel.app
🔒 Store these credentials safely. Thank you for supporting CricPass!
━━━━━━━━━━━━━━━━━━━━━━`;

  if (client && isReady) {
    try {
      return await client.sendMessage(chatId, messageText);
    } catch (err) {
      console.warn('⚠️ [WhatsApp] Failed to send team credentials message:', err.message);
    }
  }
  return null;
}

module.exports = {
  initializeWhatsAppClient,
  sendWhatsAppOTP,
  sendTeamCredentialsWhatsApp,
  formatPhoneNumber,
  getWhatsAppChatId,
  isWhatsAppReady: () => isReady
};