
const config = require('../../config/config.json');

/**
 * SAFE ADD-ON: Post-Claim Payment Injector
 * DOES NOT modify existing system
 */
async function sendPaymentAfterClaim(ticket, channel) {
  if (!ticket) return;

  const embed = {
    title: '💳 PAYMENT REQUIRED (POST CLAIM)',
    description: `
Buyer: ${ticket.user}
Item: ${ticket.item}
Total: Rp ${ticket.price}

📌 DANA: ${config.payment.dana}
A/N: ${config.payment.name}
    `,
    color: 0x00ff99
  };

  if (ticket.qris) {
    embed.image = { url: ticket.qris };
  }

  return channel.send({ embeds: [embed] });
}

module.exports = { sendPaymentAfterClaim };
