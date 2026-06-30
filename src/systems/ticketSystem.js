const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('./configBridge');
const ds = require('./dataStore');
const { isSnowflake } = require('./utils');

const Flags = PermissionsBitField.Flags;

/**
 * TICKET LOCK SYSTEM
 * On creation a ticket is LOCKED: the buyer can VIEW but cannot SEND messages.
 * After staff claims it, `unlockForUser` grants SendMessages.
 */
async function createTicket(guild, user, name) {
  const overwrites = [
    { id: guild.id, deny: [Flags.ViewChannel] },
    { id: user.id, allow: [Flags.ViewChannel], deny: [Flags.SendMessages] }
  ];

  if (isSnowflake(config.staffRole)) {
    overwrites.push({ id: config.staffRole, allow: [Flags.ViewChannel, Flags.SendMessages] });
  }
  if (isSnowflake(config.adminRole) && config.adminRole !== config.staffRole) {
    overwrites.push({ id: config.adminRole, allow: [Flags.ViewChannel, Flags.SendMessages] });
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: isSnowflake(config.categoryId) ? config.categoryId : undefined,
    permissionOverwrites: overwrites
  });
}

async function unlockForUser(channel, userId) {
  try {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true
    });
  } catch (_) {
    // channel may have been deleted; ignore
  }
}

// ---- ticket persistence helpers -------------------------------------------
function allTickets() {
  return ds.readSync('tickets.json', []);
}

function getTicket(channelId) {
  return allTickets().find((t) => t.channelId === channelId);
}

function getActiveTicketForUser(userId) {
  const open = ['locked', 'claimed', 'awaiting_verify', 'paid'];
  return allTickets().find((t) => t.userId === userId && open.includes(t.status));
}

function addTicket(ticket) {
  return ds.update('tickets.json', [], (list) => {
    list.push(ticket);
    return list;
  });
}

function updateTicket(channelId, patch) {
  let updated = null;
  return ds
    .update('tickets.json', [], (list) => {
      const idx = list.findIndex((t) => t.channelId === channelId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
        updated = list[idx];
      }
      return list;
    })
    .then(() => updated);
}

module.exports = {
  createTicket,
  unlockForUser,
  allTickets,
  getTicket,
  getActiveTicketForUser,
  addTicket,
  updateTicket
};
