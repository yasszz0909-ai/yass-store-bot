
require('dotenv').config();
const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const STAFF_ROLE_ID = "ISI_ROLE_STAFF";
const CATEGORY_ID = "ISI_CATEGORY_ID";

const data = JSON.parse(fs.readFileSync('./data/products.json'));
const stock = JSON.parse(fs.readFileSync('./data/stock.json'));
const ordersPath = './data/orders.json';

function saveOrder(order){
  const orders = JSON.parse(fs.readFileSync(ordersPath));
  orders.push(order);
  fs.writeFileSync(ordersPath, JSON.stringify(orders,null,2));
}

function getStock(game, amount){
  return stock?.[game]?.[amount] || 0;
}

function reduceStock(game, amount){
  stock[game][amount] -= 1;
  fs.writeFileSync('./data/stock.json', JSON.stringify(stock,null,2));
}

function clean(t){
  return t.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,15);
}

let counter = 1;

function ticketName(game,item){
  return `[${clean(game)}-${clean(item)}-${String(counter++).padStart(4,'0')}]`;
}

client.once('ready', ()=> console.log("Bot ON"));

client.on('messageCreate', async (msg)=>{
  if(msg.content === '!store'){
    const g = data.free_fire;

    const embed = new EmbedBuilder()
      .setTitle(g.title)
      .setDescription(g.tagline);

    const options = g.diamonds.map((d,i)=>({
      label: `${d.amount} Diamond`,
      description: `Rp ${d.price}`,
      value: `diamond_${i}`
    }));

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('buy')
        .setPlaceholder('Pilih item')
        .addOptions(options)
    );

    msg.channel.send({embeds:[embed], components:[menu]});
  }
});

client.on('interactionCreate', async (i)=>{

  // SELECT
  if(i.isStringSelectMenu()){

    const idx = i.values[0].split('_')[1];
    const item = data.free_fire.diamonds[idx];

    if(getStock('free_fire', item.amount)<=0){
      return i.reply({content:"Stock habis!", ephemeral:true});
    }

    reduceStock('free_fire', item.amount);

    const name = ticketName('ff', item.amount+"dm");

    const ch = await i.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID,
      permissionOverwrites:[
        {id:i.guild.id, deny:[PermissionsBitField.Flags.ViewChannel]},
        {id:i.user.id, allow:[PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]}
      ]
    });

    saveOrder({
      invoice:`YS-${Date.now()}`,
      user:i.user.tag,
      item:`${item.amount} Diamond`,
      price:item.price,
      status:"pending"
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    ch.send({content:"Ticket dibuat!", components:[row]});

    return i.reply({content:`Ticket: ${ch}`, ephemeral:true});
  }

  // CLAIM
  if(i.customId === 'claim'){
    if(!i.member.roles.cache.has(STAFF_ROLE_ID))
      return i.reply({content:"Only staff", ephemeral:true});

    return i.reply("Ticket di-claim!");
  }

  // CLOSE
  if(i.customId === 'close'){
    await i.reply("Closing...");
    setTimeout(()=> i.channel.delete().catch(()=>{}), 3000);
  }

});

client.login(process.env.TOKEN);
