const config = require('./configBridge');

/**
 * Anti-spam cooldowns + per-user transaction locks (anti double-order).
 */
const cooldowns = new Map(); // "userId:key" -> expiresAt
const transactionLocks = new Set(); // userId currently mid-transaction

/**
 * Returns remaining ms if the user is still on cooldown for `key`, otherwise 0
 * and (re)starts the cooldown window.
 */
function check(userId, key, ms) {
  if (!config.features.antiSpam || !ms) return 0;
  const mapKey = `${userId}:${key}`;
  const now = Date.now();
  const expires = cooldowns.get(mapKey) || 0;
  if (now < expires) return expires - now;
  cooldowns.set(mapKey, now + ms);
  return 0;
}

function acquire(userId) {
  if (transactionLocks.has(userId)) return false;
  transactionLocks.add(userId);
  return true;
}

function release(userId) {
  transactionLocks.delete(userId);
}

module.exports = { check, acquire, release };
