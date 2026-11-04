const crypto = require('crypto');

/**
 * Generate a cryptographically secure numeric OTP of specified length.
 * Default length is 6 digits (e.g. 100000 - 999999).
 *
 * @param {number} length - Number of digits
 * @returns {string} - String OTP
 */
function generateOTP(length = 6) {
  if (length <= 0) length = 6;
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  const otpNumber = crypto.randomInt(min, max + 1);
  return otpNumber.toString();
}

/**
 * Helper to simulate sending SMS notifications to phone numbers.
 * In a real production setup, integrate Twilio, AWS SNS, or a local SMS gateway here.
 *
 * @param {string} phoneNumber
 * @param {string} message
 */
function sendSimulatedSMS(phoneNumber, message) {
  const timestamp = new Date().toISOString();
  console.log('----------------------------------------------------');
  console.log(`[SMS GATEWAY SIMULATION] ${timestamp}`);
  console.log(`To: ${phoneNumber}`);
  console.log(`Message: ${message}`);
  console.log('----------------------------------------------------');
}

module.exports = {
  generateOTP,
  sendSimulatedSMS
};
