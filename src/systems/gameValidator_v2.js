const { sanitizeText } = require('./utils');

const FAKE_VALUES = new Set([
  'test', 'testing', 'admin', 'null', 'undefined', 'none',
  '0000', '1234', '12345', '123456', 'asdf', 'qwerty', 'aaaa', 'xxxx'
]);

/**
 * Anti fake-input detection: rejects empty, single-character-repeat, and common
 * placeholder values.
 */
function looksFake(value) {
  const v = sanitizeText(value, 32).toLowerCase();
  if (!v) return true;
  if (/^(.)\1{3,}$/.test(v)) return true; // e.g. 00000000, aaaa
  if (FAKE_VALUES.has(v)) return true;
  return false;
}

/**
 * Validates a game account payload before checkout.
 *   ff     -> userId: 8-12 digits
 *   ml     -> userId: 5-12 digits + zoneId: 1-6 digits
 *   roblox -> username/userId: 3-30 chars [A-Za-z0-9_]
 */
function validateGame(type, data) {
  const userId = sanitizeText(data.userId, 20);
  const zoneId = sanitizeText(data.zoneId, 12);
  const username = sanitizeText(data.username, 32);

  if (type === 'ff') {
    return /^\d{8,12}$/.test(userId) && !looksFake(userId);
  }

  if (type === 'ml') {
    return /^\d{5,12}$/.test(userId) && /^\d{1,6}$/.test(zoneId) && !looksFake(userId);
  }

  if (type === 'roblox') {
    const handle = username || userId;
    return /^[A-Za-z0-9_]{3,30}$/.test(handle) && !looksFake(handle);
  }

  return false;
}

function sanitizeAccount(data) {
  return {
    userId: sanitizeText(data.userId, 20),
    zoneId: sanitizeText(data.zoneId, 12),
    username: sanitizeText(data.username, 32)
  };
}

module.exports = { validateGame, sanitizeAccount, looksFake };
