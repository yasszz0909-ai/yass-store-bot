require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

const config = require('./src/systems/configBridge');
const ds = require('./src/systems/dataStore');
const logger = require('./src/systems/safetyLogger');
const cooldowns = require('./src/systems/cooldownManager');
const { validateGame, sanitizeAccount } = require('./src/systems/gameValidator_v2');
const { isSnowflake, isStaffMember, sanitizeText, firstImageAttachment } = require('./src/systems/utils');
const ticketSystem = require('./src/systems/ticketSystem');
const paymentManager = require('./src/systems/paymentManager');
const { sendPaymentAfterClaim, buildPaymentEmbed, paymentButtons } = require('./src/systems/paymentPostClaim_v2');
const dashboard = require('./src/systems/dashboard');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ---------------------------------------------------------------------------
// Catalog + persistence helpers
// ---------------------------------------------------------------------------
const products = () => ds.readSync('products.json', {});
const itemsOf = (game) => (game && (game.items || game.diamonds || game.robux)) || [];

function getStock(gameKey, amount) {
  const stock = ds.readSync('stock.json', {});
  return stock?.[gameKey]?.[String(amount)] ?? 0;
}

async function reserveStock(gameKey, amount) {
  let reserved = false;
  await ds.update('stock.json', {}, (stock) => {
    if (!stock[gameKey]) stock[gameKey] = {};
    const key = String(amount);
    const current = stock[gameKey][key] ?? 0;
    if (current > 0) {
      stock[gameKey][key] = current - 1;
      reserved = true;
    }
    return stock;
  });
  return reserved;
}

async function restoreStock(gameKey, amount) {
  await ds.update('stock.json', {}, (stock) => {
    if (!stock[gameKey]) stock[gameKey] = {};
    const key = String(amount);
    stock[gameKey][key] = (stock[gameKey][key] ?? 0) + 1;
    return stock;
  });
}

const addOrder = (order) => ds.update('orders.json', [], (l) => { l.push(order); return l; });
const addInvoice = (inv) => ds.update('invoices.json', [], (l) => { l.push(inv); return l; });

const addHistory = (event, user, extra = {}) =>
  ds.update('history.json', [], (l) => {
    l.push({ at: new Date().toISOString(), event, user, ...extra });
    if (l.length > 500) l.splice(0, l.length - 500);
    return l;
  });

const upsertPayment = (record) =>
  ds.update('payments.json', [], (l) => {
    const idx = l.findIndex((p) => p.invoice === record.invoice);
    if (idx >= 0) l[idx] = { ...l[idx], ...record };
    else l.push(record);
    return l;
  });

const clean = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);

function ticketName(gameKey, label) {
  const n = String(ticketSystem.allTickets().length + 1).padStart(4, '0');
  return `${clean(gameKey)}-${clean(label)}-${n}`;
}

// ---------------------------------------------------------------------------
// Safe interaction helpers
// ---------------------------------------------------------------------------
// Normalize the deprecated `ephemeral: true` option to the `flags` form.
function eph(payload) {
  if (payload && typeof payload === 'object' && payload.ephemeral) {
    const { ephemeral, ...rest } = payload;
    rest.flags = (rest.flags || 0) | MessageFlags.Ephemeral;
    return rest;
  }
  return payload;
}

function stripEph(payload) {
  if (payload && typeof payload === 'object' && 'ephemeral' in payload) {
    const { ephemeral, ...rest } = payload;
    return rest;
  }
  return payload;
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) return await interaction.followUp(eph(payload));
    return await interaction.reply(eph(payload));
  } catch (err) {
    logger.log('REPLY_FAIL', err.message);
  }
}

async function safeUpdate(interaction, payload) {
  try {
    return await interaction.update(stripEph(payload));
  } catch (err) {
    logger.log('UPDATE_FAIL', err.message);
  }
}

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------
function storeMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🛒 YASS STORE')
    .setDescription('Pilih game di bawah untuk mulai top up.')
    .setColor(0x5865f2);

  const options = Object.entries(products()).map(([key, game]) => ({
    label: (game.title || key).slice(0, 100),
    description: (game.tagline || '').slice(0, 90) || undefined,
    value: key
  }));

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('game_select').setPlaceholder('Pilih game').addOptions(options)
  );

  return { embeds: [embed], components: [menu] };
}

function itemSelect(gameKey, game) {
  const options = itemsOf(game).map((item, i) => ({
    label: (item.label || `${item.amount}`).slice(0, 100),
    description: `Rp ${item.price}`,
    value: String(i)
  }));

  const embed = new EmbedBuilder()
    .setTitle(game.title || gameKey)
    .setDescription(game.tagline || 'Pilih item yang ingin dibeli.')
    .setColor(0x5865f2);

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`buy:${gameKey}`).setPlaceholder('Pilih item').addOptions(options)
  );

  return { embeds: [embed], components: [menu], ephemeral: true };
}

function textRow(id, label, required = true) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required)
  );
}

function orderModal(gameKey, index, game, item) {
  const modal = new ModalBuilder()
    .setCustomId(`order:${gameKey}:${index}`)
    .setTitle(`Order ${item.label || game.title}`.slice(0, 45));

  if (game.game_id === 'roblox') {
    modal.addComponents(textRow('username', 'Roblox Username / User ID'));
  } else if (game.game_id === 'ml') {
    modal.addComponents(textRow('userId', 'User ID'), textRow('zoneId', 'Zone ID'));
  } else {
    modal.addComponents(textRow('userId', 'Game User ID'));
  }
  return modal;
}

function paymentModal(customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle('Set Payment');
  modal.addComponents(
    textRow('dana', 'DANA Number', true),
    textRow('name', 'Account Name (A/N)', true),
    textRow('qris', 'QRIS Image URL (optional)', false)
  );
  return modal;
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

// ---------------------------------------------------------------------------
// Order creation (modal submit)
// ---------------------------------------------------------------------------
async function handleOrderSubmit(interaction) {
  const [, gameKey, idxStr] = interaction.customId.split(':');
  const game = products()[gameKey];
  const item = itemsOf(game)[Number(idxStr)];
  if (!game || !item) {
    return safeReply(interaction, { content: 'Pesanan tidak valid.', ephemeral: true });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Anti double-order: serialize per user.
  if (!cooldowns.acquire(interaction.user.id)) {
    return interaction.editReply({ content: 'Order Anda sedang diproses. Mohon tunggu sebentar.' });
  }

  try {
    const field = (id) => {
      try {
        return interaction.fields.getTextInputValue(id);
      } catch {
        return undefined;
      }
    };
    const account = sanitizeAccount({ userId: field('userId'), zoneId: field('zoneId'), username: field('username') });

    if (config.features.gameIdValidation && !validateGame(game.game_id, account)) {
      return interaction.editReply({ content: 'Data akun game tidak valid / terdeteksi palsu. Periksa kembali.' });
    }

    if (ticketSystem.getActiveTicketForUser(interaction.user.id)) {
      return interaction.editReply({ content: 'Anda masih punya order aktif. Selesaikan dulu sebelum order baru.' });
    }

    const reserved = await reserveStock(gameKey, item.amount);
    if (!reserved) {
      return interaction.editReply({ content: 'Stock habis!' });
    }

    let channel;
    try {
      channel = await ticketSystem.createTicket(
        interaction.guild,
        interaction.user,
        ticketName(gameKey, item.label || `${item.amount}`)
      );
    } catch (err) {
      await restoreStock(gameKey, item.amount); // roll back reservation
      logger.log('TICKET_CREATE_FAIL', err.message);
      return interaction.editReply({ content: 'Gagal membuat ticket. Cek CATEGORY ID & permission bot.' });
    }

    const accountLabel = account.username || [account.userId, account.zoneId].filter(Boolean).join(' / ');
    const invoice = `YS-${Date.now()}`;
    const base = {
      invoice,
      user: interaction.user.tag,
      userId: interaction.user.id,
      game: gameKey,
      gameTitle: game.title || gameKey,
      item: item.label || `${item.amount}`,
      price: item.price,
      account: accountLabel,
      channelId: channel.id,
      createdAt: new Date().toISOString()
    };

    await addOrder({ ...base, status: 'pending' });
    await addInvoice({ ...base, status: 'pending' });
    await ticketSystem.addTicket({ ...base, status: 'locked', claimed: false });
    await addHistory('order_created', interaction.user.tag, { invoice, item: base.item });

    const summary = new EmbedBuilder()
      .setTitle(`🎫 Ticket ${invoice}`)
      .setColor(0xffaa00)
      .addFields(
        { name: 'Game', value: base.gameTitle, inline: true },
        { name: 'Item', value: base.item, inline: true },
        { name: 'Harga', value: `Rp ${item.price}`, inline: true },
        { name: 'Akun', value: accountLabel || '-', inline: false },
        { name: 'Buyer', value: `${interaction.user}`, inline: true },
        { name: 'Status', value: '🔒 LOCKED — menunggu staff claim', inline: true }
      )
      .setFooter({ text: 'Pembayaran & chat akan terbuka setelah staff claim.' });

    await channel.send({
      content: `${interaction.user} Ticket dibuat! Mohon tunggu staff melakukan claim.`,
      embeds: [summary],
      components: [ticketButtons()]
    });

    await logger.logTransaction(`🆕 Order ${invoice} • ${base.gameTitle} ${base.item} • Rp ${item.price} • ${interaction.user.tag}`);
    return interaction.editReply({ content: `Ticket dibuat: ${channel}` });
  } finally {
    cooldowns.release(interaction.user.id);
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
async function handleClaim(interaction) {
  if (!isStaffMember(interaction.member)) {
    return safeReply(interaction, { content: 'Hanya staff yang bisa claim.', ephemeral: true });
  }
  const ticket = ticketSystem.getTicket(interaction.channel.id);
  if (!ticket) return safeReply(interaction, { content: 'Ticket tidak ditemukan.', ephemeral: true });
  if (ticket.claimed) return safeReply(interaction, { content: 'Ticket sudah di-claim.', ephemeral: true });

  const updated = await ticketSystem.updateTicket(interaction.channel.id, {
    claimed: true,
    status: 'claimed',
    claimedBy: interaction.user.tag,
    claimerId: interaction.user.id
  });

  await ticketSystem.unlockForUser(interaction.channel, ticket.userId); // unlock chat
  await interaction.reply(`Ticket di-claim oleh ${interaction.user}! Chat & pembayaran sekarang terbuka.`);

  if (config.features.paymentPostClaimOnly) {
    await sendPaymentAfterClaim(updated || ticket, interaction.channel, interaction.user.id);
  }
  await addHistory('ticket_claimed', interaction.user.tag, { invoice: ticket.invoice });
  await logger.logTransaction(`✅ Claim ${ticket.invoice} oleh ${interaction.user.tag}`);
}

async function handleClose(interaction) {
  const ticket = ticketSystem.getTicket(interaction.channel.id);
  const isOwner = ticket && ticket.userId === interaction.user.id;
  if (!isStaffMember(interaction.member) && !isOwner) {
    return safeReply(interaction, { content: 'Hanya staff atau pemilik ticket yang bisa menutup.', ephemeral: true });
  }
  if (ticket) await ticketSystem.updateTicket(interaction.channel.id, { status: 'closed' });
  await interaction.reply('Closing ticket dalam 5 detik...');
  await addHistory('ticket_closed', interaction.user.tag, { invoice: ticket?.invoice });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

async function handlePaymentVerify(interaction, action) {
  if (!isStaffMember(interaction.member)) {
    return safeReply(interaction, { content: 'Hanya staff yang bisa verifikasi.', ephemeral: true });
  }
  const ticket = ticketSystem.getTicket(interaction.channel.id);
  if (!ticket) return safeReply(interaction, { content: 'Ticket tidak ditemukan.', ephemeral: true });

  const map = {
    pay_approve: { status: 'paid', pay: 'approved', msg: '✅ Pembayaran disetujui.' },
    pay_reject: { status: 'payment_rejected', pay: 'rejected', msg: '❌ Pembayaran ditolak.' },
    pay_done: { status: 'done', pay: 'done', msg: '✅ Order selesai. Terima kasih!' }
  }[action];

  await ticketSystem.updateTicket(interaction.channel.id, { status: map.status });
  await upsertPayment({
    invoice: ticket.invoice,
    channelId: ticket.channelId,
    user: ticket.user,
    item: ticket.item,
    price: ticket.price,
    status: map.pay,
    verifiedBy: interaction.user.tag,
    at: new Date().toISOString()
  });
  await addHistory(`payment_${map.pay}`, interaction.user.tag, { invoice: ticket.invoice });
  await logger.logTransaction(`${map.msg} ${ticket.invoice} (${interaction.user.tag})`);
  return interaction.reply(map.msg);
}

// ---------------------------------------------------------------------------
// Dashboard / reset / payment manager
// ---------------------------------------------------------------------------
async function handleDashMenu(interaction) {
  if (!isStaffMember(interaction.member)) {
    return safeReply(interaction, { content: 'Khusus admin.', ephemeral: true });
  }
  const choice = interaction.values[0];
  if (choice === 'payment') return safeUpdate(interaction, dashboard.paymentManagerView());
  if (choice === 'reset') return safeUpdate(interaction, dashboard.resetConfirm());
  if (choice === 'tickets') return safeUpdate(interaction, { embeds: [dashboard.ticketMonitorEmbed()], components: [] });
  if (choice === 'activity') return safeUpdate(interaction, { embeds: [dashboard.activityEmbed()], components: [] });
  if (choice === 'transactions') return safeUpdate(interaction, { embeds: [dashboard.transactionEmbed()], components: [] });
}

async function handleReset(interaction, confirmed) {
  if (!isStaffMember(interaction.member)) {
    return safeReply(interaction, { content: 'Khusus admin.', ephemeral: true });
  }
  if (!confirmed) {
    return safeUpdate(interaction, { content: 'Reset dibatalkan.', embeds: [], components: [] });
  }
  const cleared = await dashboard.performReset();
  await addHistory('data_reset', interaction.user.tag, { cleared });
  await logger.logTransaction(`♻️ Data direset oleh ${interaction.user.tag}: ${cleared.join(', ')}`);
  return safeUpdate(interaction, { content: `✅ Data direset: ${cleared.join(', ')}`, embeds: [], components: [] });
}

async function handlePaymentModal(interaction) {
  if (!isStaffMember(interaction.member)) {
    return safeReply(interaction, { content: 'Khusus admin.', ephemeral: true });
  }
  const payment = {
    dana: sanitizeText(interaction.fields.getTextInputValue('dana'), 32),
    name: sanitizeText(interaction.fields.getTextInputValue('name'), 64),
    qris: sanitizeText(interaction.fields.getTextInputValue('qris'), 300)
  };

  if (interaction.customId === 'ptmodal') {
    const ticket = ticketSystem.getTicket(interaction.channel.id);
    if (!ticket) return safeReply(interaction, { content: 'Jalankan di dalam channel ticket.', ephemeral: true });
    await paymentManager.setTicketPayment(interaction.channel.id, payment);
    await safeReply(interaction, { content: 'Payment ticket ini di-set.', ephemeral: true });
    if (ticket.claimed && config.features.paymentPostClaimOnly) {
      const updated = ticketSystem.getTicket(interaction.channel.id);
      await interaction.channel
        .send({ embeds: [buildPaymentEmbed(updated, ticket.claimerId)], components: [paymentButtons()] })
        .catch(() => {});
    }
    return;
  }

  // admmodal
  await paymentManager.setAdminPayment(interaction.user.id, payment);
  return safeReply(interaction, { content: 'Default payment Anda di-set.', ephemeral: true });
}

// ---------------------------------------------------------------------------
// Slash command registration
// ---------------------------------------------------------------------------
async function registerCommands() {
  const commands = [
    { name: 'store', description: 'Tampilkan Yass Store' },
    { name: 'panel', description: 'Admin dashboard (khusus admin)' },
    { name: 'resetdata', description: 'Reset data transaksi (khusus admin)' }
  ];
  try {
    if (isSnowflake(config.guildId)) {
      const guild = await client.guilds.fetch(config.guildId).catch(() => null);
      if (guild) {
        await guild.commands.set(commands);
        return;
      }
    }
    await client.application.commands.set(commands);
  } catch (err) {
    logger.log('CMD_REGISTER_FAIL', err.message);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
client.once('ready', async () => {
  logger.setClient(client);
  logger.log('READY', `Logged in as ${client.user.tag}`);
  console.log('Bot ON');
  await registerCommands();
});

client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    if (msg.content.trim() === '!store') {
      if (!Object.keys(products()).length) {
        return msg.channel.send('Belum ada produk yang tersedia.').catch(() => {});
      }
      return msg.channel.send(storeMessage()).catch((err) => logger.log('STORE_SEND_FAIL', err.message));
    }

    // Image uploads inside a ticket channel: staff -> QRIS, buyer -> payment proof.
    const ticket = ticketSystem.getTicket(msg.channel.id);
    if (!ticket) return;
    const image = firstImageAttachment(msg);
    if (!image) return;

    if (isStaffMember(msg.member)) {
      await ticketSystem.updateTicket(msg.channel.id, { qris: image.url });
      await msg.reply('📷 QRIS di-set untuk ticket ini.').catch(() => {});
      if (ticket.claimed && config.features.paymentPostClaimOnly) {
        const updated = ticketSystem.getTicket(msg.channel.id);
        await msg.channel
          .send({ embeds: [buildPaymentEmbed(updated, ticket.claimerId)], components: [paymentButtons()] })
          .catch(() => {});
      }
    } else if (msg.author.id === ticket.userId) {
      await ticketSystem.updateTicket(msg.channel.id, { proof: image.url, status: 'awaiting_verify' });
      await upsertPayment({
        invoice: ticket.invoice,
        channelId: ticket.channelId,
        user: ticket.user,
        price: ticket.price,
        proof: image.url,
        status: 'awaiting_verify',
        at: new Date().toISOString()
      });
      await addHistory('proof_uploaded', msg.author.tag, { invoice: ticket.invoice });
      await msg.reply('✅ Bukti diterima. Menunggu verifikasi admin.').catch(() => {});
    }
  } catch (err) {
    logger.log('MESSAGE_ERROR', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'store') {
        return interaction.reply(storeMessage());
      }
      if (interaction.commandName === 'panel') {
        if (!isStaffMember(interaction.member)) {
          return interaction.reply(eph({ content: 'Khusus admin.', ephemeral: true }));
        }
        return interaction.reply(eph(dashboard.buildDashboard()));
      }
      if (interaction.commandName === 'resetdata') {
        if (!isStaffMember(interaction.member)) {
          return interaction.reply(eph({ content: 'Khusus admin.', ephemeral: true }));
        }
        return interaction.reply(eph(dashboard.resetConfirm()));
      }
      return;
    }

    // Select menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'game_select') {
        const gameKey = interaction.values[0];
        const game = products()[gameKey];
        if (!game) return safeReply(interaction, { content: 'Game tidak ditemukan.', ephemeral: true });
        return safeReply(interaction, itemSelect(gameKey, game));
      }

      if (interaction.customId.startsWith('buy:')) {
        const gameKey = interaction.customId.split(':')[1];
        const game = products()[gameKey];
        const index = Number(interaction.values[0]);
        const item = itemsOf(game)[index];
        if (!game || !item) return safeReply(interaction, { content: 'Item tidak ditemukan.', ephemeral: true });

        const wait = cooldowns.check(interaction.user.id, 'checkout', config.cooldown.checkout);
        if (wait) {
          return safeReply(interaction, { content: `Tunggu ${Math.ceil(wait / 1000)}s sebelum checkout lagi.`, ephemeral: true });
        }
        if (ticketSystem.getActiveTicketForUser(interaction.user.id)) {
          return safeReply(interaction, { content: 'Anda masih punya order aktif.', ephemeral: true });
        }
        if (getStock(gameKey, item.amount) <= 0) {
          return safeReply(interaction, { content: 'Stock habis!', ephemeral: true });
        }
        return interaction.showModal(orderModal(gameKey, index, game, item));
      }

      if (interaction.customId === 'dash_menu') return handleDashMenu(interaction);
      return;
    }

    // Modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('order:')) return handleOrderSubmit(interaction);
      if (interaction.customId === 'ptmodal' || interaction.customId === 'admmodal') {
        return handlePaymentModal(interaction);
      }
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const id = interaction.customId;
      const wait = cooldowns.check(interaction.user.id, `btn:${id}`, config.cooldown.buttonClick);
      if (wait) return safeReply(interaction, { content: 'Jangan spam tombol.', ephemeral: true });

      if (id === 'claim') return handleClaim(interaction);
      if (id === 'close') return handleClose(interaction);
      if (id === 'pay_approve' || id === 'pay_reject' || id === 'pay_done') {
        return handlePaymentVerify(interaction, id);
      }
      if (id === 'reset_confirm') return handleReset(interaction, true);
      if (id === 'reset_cancel') return handleReset(interaction, false);
      if (id === 'pm_ticket') {
        if (!isStaffMember(interaction.member)) return safeReply(interaction, { content: 'Khusus admin.', ephemeral: true });
        return interaction.showModal(paymentModal('ptmodal'));
      }
      if (id === 'pm_admin') {
        if (!isStaffMember(interaction.member)) return safeReply(interaction, { content: 'Khusus admin.', ephemeral: true });
        return interaction.showModal(paymentModal('admmodal'));
      }
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
client.on('shardError', (err) => logger.log('SHARD_ERROR', err.message));
process.on('unhandledRejection', (err) => logger.log('UNHANDLED_REJECTION', err?.message || err));
process.on('uncaughtException', (err) => logger.log('UNCAUGHT_EXCEPTION', err?.message || err));

if (!config.token) {
  console.error('TOKEN tidak ditemukan. Set TOKEN di .env atau config/config.json terlebih dahulu.');
  process.exit(1);
}

client.login(config.token).catch((err) => {
  console.error('Gagal login:', err.message);
  process.exit(1);
});
