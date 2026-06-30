const config = require('./configBridge');
const { isSnowflake } = require('./utils');

/**
 * Lightweight logger. Always logs to console; when a client is attached and a
 * log channel is configured, transactions are also mirrored to that channel.
 */
let clientRef = null;

function setClient(client) {
  clientRef = client;
}

function log(action, data) {
  console.log('[SAFE_LOG]', action, data === undefined ? '' : data);
}

async function logTransaction(message) {
  log('TX', typeof message === 'string' ? message : JSON.stringify(message));
  if (!clientRef || !isSnowflake(config.logChannel)) return;
  try {
    const channel = await clientRef.channels.fetch(config.logChannel).catch(() => null);
    if (channel && channel.isTextBased?.()) {
      await channel.send(typeof message === 'string' ? message : `\`\`\`json\n${JSON.stringify(message, null, 2)}\n\`\`\``);
    }
  } catch (err) {
    log('LOG_CHANNEL_FAIL', err.message);
  }
}

module.exports = { log, logTransaction, setClient };
