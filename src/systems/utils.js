const { PermissionsBitField } = require('discord.js');
const config = require('./configBridge');

const isSnowflake = (v) => /^\d{5,}$/.test(String(v || ''));

function isStaffMember(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  } catch (_) {
    // ignore
  }
  const roles = member.roles?.cache;
  if (!roles) return false;
  return (
    (isSnowflake(config.adminRole) && roles.has(config.adminRole)) ||
    (isSnowflake(config.staffRole) && roles.has(config.staffRole))
  );
}

function sanitizeText(value, max = 64) {
  if (typeof value !== 'string') return '';
  // Strip backticks and @ to avoid embed/mention abuse, collapse whitespace.
  return value.replace(/[`@]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstImageAttachment(message) {
  if (!message?.attachments?.size) return null;
  for (const att of message.attachments.values()) {
    const isImage =
      (att.contentType && att.contentType.startsWith('image/')) ||
      /\.(png|jpe?g|webp|gif)$/i.test(att.name || att.url || '');
    if (isImage) return att;
  }
  return null;
}

module.exports = { isSnowflake, isStaffMember, sanitizeText, firstImageAttachment };
