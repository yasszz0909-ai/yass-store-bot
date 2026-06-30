
const config = require('../../config/config.json');

/**
 * SAFE CONFIG ACCESS LAYER
 * prevents hardcode dependency issues
 */
module.exports = {
  token: config.token,
  clientId: config.clientId,
  guildId: config.guildId,
  adminRole: config.adminRole,
  payment: config.payment
};
