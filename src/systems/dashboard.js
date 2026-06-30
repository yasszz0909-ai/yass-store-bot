const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ds = require('./dataStore');

// Files cleared by /resetdata. Inventory & config are intentionally preserved.
const RESET_FILES = {
  'orders.json': [],
  'tickets.json': [],
  'invoices.json': [],
  'cart.json': [],
  'history.json': [],
  'payments.json': []
};

function buildDashboard() {
  const embed = new EmbedBuilder()
    .setTitle('📊 ADMIN DASHBOARD')
    .setColor(0x5865f2)
    .setDescription('Pilih menu manajemen di bawah ini.');

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('dash_menu')
      .setPlaceholder('Pilih menu')
      .addOptions(
        { label: 'Payment Manager', value: 'payment', description: 'Set payment per ticket / admin', emoji: '💳' },
        { label: 'Reset Data Panel', value: 'reset', description: 'Reset orders/tickets/invoices/cart/history', emoji: '♻️' },
        { label: 'Ticket Monitor', value: 'tickets', description: 'Lihat status semua ticket', emoji: '🎫' },
        { label: 'User Activity Log', value: 'activity', description: 'Aktivitas user terbaru', emoji: '🧾' },
        { label: 'Transaction Tracker', value: 'transactions', description: 'Ringkasan transaksi', emoji: '📈' }
      )
  );

  return { embeds: [embed], components: [menu], ephemeral: true };
}

function ticketMonitorEmbed() {
  const tickets = ds.readSync('tickets.json', []);
  const recent = tickets.slice(-10).reverse();
  const lines = recent.length
    ? recent.map((t) => `\`${t.invoice}\` • ${t.item} • **${t.status}** • <#${t.channelId}>`).join('\n')
    : 'Belum ada ticket.';
  return new EmbedBuilder().setTitle('🎫 Ticket Monitor').setColor(0xffaa00).setDescription(lines);
}

function activityEmbed() {
  const history = ds.readSync('history.json', []);
  const recent = history.slice(-10).reverse();
  const lines = recent.length
    ? recent.map((h) => `\`${(h.at || '').slice(0, 19)}\` • ${h.event} • ${h.user || ''}`).join('\n')
    : 'Belum ada aktivitas.';
  return new EmbedBuilder().setTitle('🧾 User Activity Log').setColor(0x5865f2).setDescription(lines);
}

function transactionEmbed() {
  const orders = ds.readSync('orders.json', []);
  const payments = ds.readSync('payments.json', []);
  const revenue = payments
    .filter((p) => p.status === 'approved' || p.status === 'done')
    .reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  return new EmbedBuilder()
    .setTitle('📈 Transaction Tracker')
    .setColor(0x00ff99)
    .addFields(
      { name: 'Total Orders', value: String(orders.length), inline: true },
      { name: 'Payments Logged', value: String(payments.length), inline: true },
      { name: 'Revenue (approved/done)', value: `Rp ${revenue}`, inline: true }
    );
}

function resetConfirm() {
  const embed = new EmbedBuilder()
    .setTitle('♻️ Reset Data Panel')
    .setColor(0xff5555)
    .setDescription(
      [
        'Ini akan **menghapus**: orders, tickets, invoices, cart, history, payments.',
        'Data **dipertahankan**: products/items, categories, stock, config.',
        '',
        'Tekan **Confirm Reset** untuk melanjutkan.'
      ].join('\n')
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reset_confirm').setLabel('Confirm Reset').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('reset_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], ephemeral: true };
}

async function performReset() {
  const cleared = [];
  for (const [file, empty] of Object.entries(RESET_FILES)) {
    await ds.update(file, empty, () => (Array.isArray(empty) ? [] : { ...empty }));
    cleared.push(file);
  }
  return cleared;
}

function paymentManagerView() {
  const embed = new EmbedBuilder()
    .setTitle('💳 Payment Manager')
    .setColor(0x00ff99)
    .setDescription(
      [
        '• **Set Payment Ticket Ini** — jalankan di dalam channel ticket untuk override payment khusus ticket tersebut.',
        '• **Set Default Payment Saya** — set payment default untuk ticket yang Anda claim (per-admin).'
      ].join('\n')
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pm_ticket').setLabel('Set Payment Ticket Ini').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pm_admin').setLabel('Set Default Payment Saya').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], ephemeral: true };
}

module.exports = {
  buildDashboard,
  ticketMonitorEmbed,
  activityEmbed,
  transactionEmbed,
  resetConfirm,
  performReset,
  paymentManagerView,
  RESET_FILES
};
