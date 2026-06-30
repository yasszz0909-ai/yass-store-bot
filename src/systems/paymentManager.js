const config = require('./configBridge');
const ds = require('./dataStore');
const ticketSystem = require('./ticketSystem');

/**
 * ADVANCED PAYMENT SYSTEM
 * Payment details can be overridden at three levels. Resolution priority
 * (highest first): per-ticket > per-user > per-admin (claimer) > global config.
 *
 * paymentConfig.json shape: { "admins": { id: {dana,name,qris} },
 *                             "users":  { id: {dana,name,qris} } }
 */
function loadOverrides() {
  return ds.readSync('paymentConfig.json', { admins: {}, users: {} });
}

function clean(obj) {
  if (!obj) return {};
  const out = {};
  for (const k of ['dana', 'name', 'qris']) {
    if (obj[k]) out[k] = obj[k];
  }
  return out;
}

function resolvePayment(ticket, claimerId) {
  const overrides = loadOverrides();
  const merged = { ...(config.payment || {}) };

  if (claimerId && overrides.admins?.[claimerId]) Object.assign(merged, clean(overrides.admins[claimerId]));
  if (ticket?.userId && overrides.users?.[ticket.userId]) Object.assign(merged, clean(overrides.users[ticket.userId]));
  if (ticket?.payment) Object.assign(merged, clean(ticket.payment));
  if (ticket?.qris) merged.qris = ticket.qris;

  return merged;
}

function setTicketPayment(channelId, payment) {
  return ticketSystem.updateTicket(channelId, { payment: clean(payment) });
}

function setOverride(scope, id, payment) {
  return ds.update('paymentConfig.json', { admins: {}, users: {} }, (data) => {
    if (!data[scope]) data[scope] = {};
    data[scope][id] = clean(payment);
    return data;
  });
}

const setAdminPayment = (adminId, payment) => setOverride('admins', adminId, payment);
const setUserPayment = (userId, payment) => setOverride('users', userId, payment);

module.exports = { resolvePayment, setTicketPayment, setAdminPayment, setUserPayment };
