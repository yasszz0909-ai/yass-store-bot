require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const config = require('./src/systems/configBridge');
const { validateGame } = require('./src/systems/gameValidator_v2');
const { sendPaymentAfterClaim } = require('./src/systems/paymentPostClaim_v2');
const logger = require('./src/systems/safetyLogger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ---------------------------------------------------------------------------
// Data store helpers (read fresh on each access so multiple actions stay in sync)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const dataPath = (file) => path.join(DATA_DIR, file);

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(file), 'utf8'));
  } catch (err) {
    logger.log('READ_FAIL', `${file}: ${err.message}`);
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(dataPath(file), JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    logger.log('WRITE_FAIL', `${file}: ${err.message}`);
    return false;
  }
}

const products = readJSON('products.json', {});

const itemsOf = (game) => (game && (game.items || game.diamonds || game.robux)) || [];

function getStock(gameKey, amount) {
  const stock = readJSON('stock.json', {});
  return stock?.[gameKey]?.[String(amount)] ?? 0;
}

function reduceStock(gameKey, amount) {
  const stock = readJSON('stock.json', {});
  if (!stock[gameKey]) stock[gameKey] = {};
  const key = String(amount);
  const current = stock[gameKey][key] ?? 0;
  if (current > 0) {
    stock[gameKey][key] = current - 1;
    writeJSON('stock.json', stock);
  }
  return stock[gameKey][key];
}

function restoreStock(gameKey, amount) {
  const stock = readJSON('stock.json', {});
  if (!stock[gameKey]) stock[gameKey] = {};
  const key = String(amount);
  stock[gameKey][key] = (stock[gameKey][key] ?? 0) + 1;
  writeJSON('stock.json', stock);
}

function addOrder(order) {
  const orders = readJSON('orders.json', []);
  orders.push(order);
  writeJSON('orders.json', orders);
}

function addTicket(ticket) {
  const tickets = readJSON('tickets.json', []);
  tickets.push(ticket);
  writeJSON('tickets.json', tickets);
}

function updateTicket(channelId, patch) {
  const tickets = readJSON('tickets.json', []);
  const idx = tickets.findIndex((t) => t.channelId === channelId);
  if (idx === -1) return null;
  tickets[idx] = { ...tickets[idx], ...patch };
  writeJSON('tickets.json', tickets);
  return tickets[idx];
}

function nextTicketNumber() {
  return readJSON('tickets.json', []).length + 1;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
const isSnowflake = (v) => /^\d{5,}$/.test(String(v || ''));

function clean(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
}

function ticketName(gameKey, label) {
  const n = String(nextTicketNumber()).padStart(4, '0');
  return `${clean(gameKey)}-${clean(label)}-${n}`;
}

// Anti-spam cooldowns: Map<"userId:key", expiresAt>
const cooldowns = new Map();

function checkCooldown(userId, key, ms) {
  if (!config.features.antiSpam || !ms) return 0;
  const mapKey = `${userId}:${key}`;
  const now = Date.now();
  const expires = cooldowns.get(mapKey) || 0;
  if (now < expires) return expires - now;
  cooldowns.set(mapKey, now + ms);
  return 0;
}

const safeReply = async (interaction, payload) => {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    logger.log('REPLY_FAIL', err.message);
  }
};

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------
function buildGameSelect() {
  const options = Object.entries(products).map(([key, game]) => ({
    label: game.title || key,
    description: (game.tagline || '').slice(0, 90) || undefined,
    value: key
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('game_select')
      .setPlaceholder('Pilih game')
      .addOptions(options)
  );
}

function buildItemSelect(gameKey, game) {
  const options = itemsOf(game).map((item, i) => ({
    label: (item.label || `${item.amount}`).slice(0, 100),
    description: `Rp ${item.price}`,
    value: String(i)
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`buy:${gameKey}`)
      .setPlaceholder('Pilih item')
      .addOptions(options)
  );
}

function textRow(id, label, required = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
  );
}

function buildOrderModal(gameKey, index, game, item) {
  const modal = new ModalBuilder()
    .setCustomId(`order:${gameKey}:${index}`)
    .setTitle(`Order ${item.label || game.title}`.slice(0, 45));

  if (game.game_id === 'roblox') {
    modal.addComponents(textRow('username', 'Roblox Username / User ID'));
  } else if (game.game_id === 'ml') {
    modal.addComponents(
      textRow('userId', 'User ID'),
      textRow('zoneId', 'Zone ID')
    );
  } else {
    modal.addComponents(textRow('userId', 'Game User ID'));
  }
  return modal;
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
client.once('ready', () => {
  logger.log('READY', `Logged in as ${client.user.tag}`);
  console.log('Bot ON');
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (msg.content.trim() !== '!store') return;

  if (!Object.keys(products).length) {
    return msg.channel.send('Belum ada produk yang tersedia.').catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setTitle('🛒 YASS STORE')
    .setDescription('Pilih game di bawah untuk mulai top up.')
    .setColor(0x5865f2);

  msg.channel.send({ embeds: [embed], components: [buildGameSelect()] }).catch((err) => {
    logger.log('STORE_SEND_FAIL', err.message);
  });
});

client.on('interactionCreate', async (interaction) => {
  try {
    // 1) Game chosen -> show items
    if (interaction.isStringSelectMenu() && interaction.customId === 'game_select') {
      const gameKey = interaction.values[0];
      const game = products[gameKey];
      if (!game) return safeReply(interaction, { content: 'Game tidak ditemukan.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(game.title || gameKey)
        .setDescription(game.tagline || 'Pilih item yang ingin dibeli.')
        .setColor(0x5865f2);

      return safeReply(interaction, {
        embeds: [embed],
        components: [buildItemSelect(gameKey, game)],
        ephemeral: true
      });
    }

    // 2) Item chosen -> open modal to collect game account info
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('buy:')) {
      const gameKey = interaction.customId.split(':')[1];
      const game = products[gameKey];
      const index = Number(interaction.values[0]);
      const item = itemsOf(game)[index];
      if (!game || !item) return safeReply(interaction, { content: 'Item tidak ditemukan.', ephemeral: true });

      const wait = checkCooldown(interaction.user.id, 'checkout', config.cooldown.checkout);
      if (wait) {
        return safeReply(interaction, {
          content: `Tunggu ${Math.ceil(wait / 1000)}s sebelum checkout lagi.`,
          ephemeral: true
        });
      }

      if (getStock(gameKey, item.amount) <= 0) {
        return safeReply(interaction, { content: 'Stock habis!', ephemeral: true });
      }

      return interaction.showModal(buildOrderModal(gameKey, index, game, item));
    }

    // 3) Modal submitted -> validate, reserve stock, open ticket
    if (interaction.isModalSubmit() && interaction.customId.startsWith('order:')) {
      const [, gameKey, idxStr] = interaction.customId.split(':');
      const game = products[gameKey];
      const item = itemsOf(game)[Number(idxStr)];
      if (!game || !item) return safeReply(interaction, { content: 'Pesanan tidak valid.', ephemeral: true });

      const field = (id) => {
        try {
          return interaction.fields.getTextInputValue(id);
        } catch {
          return undefined;
        }
      };
      const account = {
        userId: field('userId'),
        zoneId: field('zoneId'),
        username: field('username')
      };

      if (config.features.gameIdValidation && !validateGame(game.game_id, account)) {
        return safeReply(interaction, {
          content: 'Data akun game tidak valid. Periksa kembali ID/zone/username.',
          ephemeral: true
        });
      }

      if (reduceStock(gameKey, item.amount) === undefined || getStock(gameKey, item.amount) < 0) {
        return safeReply(interaction, { content: 'Stock habis!', ephemeral: true });
      }

      const accountLabel = account.username
        ? account.username
        : [account.userId, account.zoneId].filter(Boolean).join(' / ');

      let channel;
      try {
        const overwrites = [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }
        ];
        if (isSnowflake(config.staffRole)) {
          overwrites.push({
            id: config.staffRole,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          });
        }

        channel = await interaction.guild.channels.create({
          name: ticketName(gameKey, item.label || `${item.amount}`),
          type: ChannelType.GuildText,
          parent: isSnowflake(config.categoryId) ? config.categoryId : undefined,
          permissionOverwrites: overwrites
        });
      } catch (err) {
        // Roll back the reserved stock if the ticket channel could not be made.
        restoreStock(gameKey, item.amount);
        logger.log('TICKET_CREATE_FAIL', err.message);
        return safeReply(interaction, {
          content: 'Gagal membuat ticket. Hubungi admin (cek CATEGORY/permission bot).',
          ephemeral: true
        });
      }

      const invoice = `YS-${Date.now()}`;
      const order = {
        invoice,
        user: interaction.user.tag,
        userId: interaction.user.id,
        game: gameKey,
        item: item.label || `${item.amount}`,
        price: item.price,
        account: accountLabel,
        channelId: channel.id,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      addOrder(order);
      addTicket({ ...order, claimed: false });

      const summary = new EmbedBuilder()
        .setTitle(`🎫 Ticket ${invoice}`)
        .setColor(0xffaa00)
        .addFields(
          { name: 'Game', value: game.title || gameKey, inline: true },
          { name: 'Item', value: order.item, inline: true },
          { name: 'Harga', value: `Rp ${item.price}`, inline: true },
          { name: 'Akun', value: accountLabel || '-', inline: false },
          { name: 'Buyer', value: `${interaction.user}`, inline: true }
        )
        .setFooter({ text: config.features.paymentPostClaimOnly ? 'Pembayaran muncul setelah di-claim staff.' : '' });

      await channel.send({
        content: `${interaction.user} Ticket dibuat! Mohon tunggu staff.`,
        embeds: [summary],
        components: [ticketButtons()]
      });

      return safeReply(interaction, { content: `Ticket dibuat: ${channel}`, ephemeral: true });
    }

    // 4) Claim button (staff only) -> reveal payment instructions
    if (interaction.isButton() && interaction.customId === 'claim') {
      if (isSnowflake(config.staffRole) && !interaction.member.roles.cache.has(config.staffRole)) {
        return safeReply(interaction, { content: 'Hanya staff yang bisa claim.', ephemeral: true });
      }

      const ticket = updateTicket(interaction.channel.id, {
        claimed: true,
        status: 'claimed',
        claimedBy: interaction.user.tag
      }) || { user: 'Buyer', item: '-', price: '-' };

      await interaction.reply(`Ticket di-claim oleh ${interaction.user}!`);

      if (config.features.paymentPostClaimOnly) {
        await sendPaymentAfterClaim(ticket, interaction.channel);
      }
      return;
    }

    // 5) Close button -> archive and delete channel
    if (interaction.isButton() && interaction.customId === 'close') {
      updateTicket(interaction.channel.id, { status: 'closed' });
      await interaction.reply('Closing ticket dalam 5 detik...');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return;
    }
  } catch (err) {
    logger.log('INTERACTION_ERROR', err.message);
    safeReply(interaction, { content: 'Terjadi kesalahan. Coba lagi.', ephemeral: true });
  }
});

// ---------------------------------------------------------------------------
// Hardening
// ---------------------------------------------------------------------------
client.on('error', (err) => logger.log('CLIENT_ERROR', err.message));
process.on('unhandledRejection', (err) => logger.log('UNHANDLED_REJECTION', err?.message || err));

if (!config.token) {
  console.error('TOKEN tidak ditemukan. Set TOKEN di file .env terlebih dahulu.');
  process.exit(1);
}

client.login(config.token).catch((err) => {
  console.error('Gagal login:', err.message);
  process.exit(1);
});
