/**
 * Calculate cooling-off period in days based on transfer type.
 * - 'ALLOWED': 14 days
 * - 'NOT_ALLOWED': 30 days (1 month cooling-off)
 *
 * @param {'ALLOWED' | 'NOT_ALLOWED'} transferType
 * @returns {number}
 */
function getCoolingOffDaysForTransfer(transferType) {
  if (transferType === 'ALLOWED') {
    return 14;
  } else if (transferType === 'NOT_ALLOWED') {
    return 30;
  }
  return 0;
}

/**
 * Calculate the future date when player will become eligible to play.
 *
 * @param {number} days
 * @param {Date} [fromDate]
 * @returns {Date}
 */
function calculateEligibleDate(days, fromDate = new Date()) {
  const base = new Date(fromDate);
  base.setDate(base.getDate() + days);
  return base;
}

/**
 * Calculate remaining cooling-off days from eligible_to_play_date.
 * Returns 0 if eligible_to_play_date has already passed or is not set.
 *
 * @param {Date | string} eligibleToPlayDate
 * @returns {number}
 */
function getRemainingCoolingOffDays(eligibleToPlayDate) {
  if (!eligibleToPlayDate) return 0;
  const now = new Date();
  const eligibleDate = new Date(eligibleToPlayDate);
  const diffMs = eligibleDate.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check if a player is currently eligible to play.
 *
 * @param {string} status
 * @param {Date | string} eligibleToPlayDate
 * @returns {boolean}
 */
function isPlayerEligibleToPlay(status, eligibleToPlayDate) {
  if (status === 'PENDING_TRANSFER') return false;
  if (!eligibleToPlayDate) return true;
  return new Date() >= new Date(eligibleToPlayDate);
}

module.exports = {
  getCoolingOffDaysForTransfer,
  calculateEligibleDate,
  getRemainingCoolingOffDays,
  isPlayerEligibleToPlay
};
