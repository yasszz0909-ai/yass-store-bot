require('dotenv').config();

const fs = require('fs');
const path = require('path');

/**
 * SAFE CONFIG ACCESS LAYER
 * - Loads config/config.json, falling back to config/config.example.json so a
 *   fresh clone never crashes on a missing (gitignored) config file.
 * - The bot token is always taken from the environment first (.env) and is
 *   never required to live in the committed config.
 */
function loadRaw() {
  const dir = path.join(__dirname, '..', '..', 'config');
  for (const file of ['config.json', 'config.example.json']) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    } catch (_) {
      // try next candidate
    }
  }
  return {};
}

const config = loadRaw();

module.exports = {
  raw: config,
  token: process.env.TOKEN || process.env.BOT_TOKEN || config.token || '',
  clientId: config.clientId,
  guildId: config.guildId,
  categoryId: config.categoryId,
  adminRole: config.adminRole,
  staffRole: config.staffRole || config.adminRole,
  logChannel: config.logChannel,
  payment: config.payment || {},
  cooldown: config.cooldown || {},
  features: config.features || {}
};
