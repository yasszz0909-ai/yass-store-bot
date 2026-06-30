const config = require('./configBridge');

/**
 * Post-Claim Payment Injector
 * Sends payment instructions to a ticket channel only AFTER staff claims it.
 */
async function sendPaymentAfterClaim(ticket, channel) {
  if (!ticket || !channel) return;

  const payment = config.payment || {};

  const embed = {
    title: '💳 PAYMENT REQUIRED (POST CLAIM)',
    description: [
      `Invoice: ${ticket.invoice || '-'}`,
      `Buyer: ${ticket.user}`,
      `Item: ${ticket.item}`,
      `Total: Rp ${ticket.price}`,
      '',
      `📌 DANA: ${payment.dana || '-'}`,
      `A/N: ${payment.name || '-'}`
    ].join('\n'),
    color: 0x00ff99
  };

  const qris = ticket.qris || payment.qris;
  if (qris) {
    embed.image = { url: qris };
  }

  return channel.send({ embeds: [embed] });
}

module.exports = { sendPaymentAfterClaim };
