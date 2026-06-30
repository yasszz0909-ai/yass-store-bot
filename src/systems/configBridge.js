require('dotenv').config();

const config = require('../../config/config.json');

/**
 * SAFE CONFIG ACCESS LAYER
 * Centralizes config access. The bot token is always read from the
 * environment (.env) and never from the committed config file.
 */
module.exports = {
  token: process.env.TOKEN || config.token,
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
