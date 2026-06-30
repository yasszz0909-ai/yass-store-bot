const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolvePayment } = require('./paymentManager');

/**
 * Builds the post-claim payment embed. Only ever shown AFTER an admin claims
 * the ticket. Includes QRIS image when one is set on the ticket/override/config.
 */
function buildPaymentEmbed(ticket, claimerId) {
  const pay = resolvePayment(ticket, claimerId);

  const embed = new EmbedBuilder()
    .setTitle('💳 PAYMENT REQUIRED')
    .setColor(0x00ff99)
    .setDescription(
      [
        `Buyer: <@${ticket.userId}>`,
        `Item: ${ticket.item}`,
        `Total: Rp ${ticket.price}`,
        '',
        '📌 PAYMENT METHOD:',
        `DANA: ${pay.dana || '-'}`,
        `A/N: ${pay.name || '-'}`
      ].join('\n')
    )
    .setFooter({ text: `Invoice: ${ticket.invoice || '-'}` });

  if (pay.qris) {
    embed.addFields({ name: '📷 QRIS', value: 'Scan QRIS di bawah ini.' });
    embed.setImage(pay.qris);
  }

  return embed;
}

function paymentButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pay_approve').setLabel('Approve Payment').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pay_reject').setLabel('Reject').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('pay_done').setLabel('Mark Done').setStyle(ButtonStyle.Secondary)
  );
}

async function sendPaymentAfterClaim(ticket, channel, claimerId) {
  if (!ticket || !channel) return null;
  return channel.send({
    embeds: [buildPaymentEmbed(ticket, claimerId)],
    components: [paymentButtons()]
  });
}

module.exports = { sendPaymentAfterClaim, buildPaymentEmbed, paymentButtons };
