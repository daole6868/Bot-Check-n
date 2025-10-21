require('dotenv').config();
const { Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, Events, ChannelType, PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cloudinary = require('cloudinary').v2;

// --- Cloudinary ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- DATA FILE ---
const DATA_DIR = path.join(__dirname,'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const META_FILE = path.join(DATA_DIR,'tickets.json');

// --- LOAD & SAVE META ---
let ticketsMeta = [];
function loadMeta() {
  if(fs.existsSync(META_FILE)) {
    try { ticketsMeta = JSON.parse(fs.readFileSync(META_FILE,'utf-8')); }
    catch(e){ console.error('Parse meta error',e); ticketsMeta=[]; saveMetaSync();}
  } else { ticketsMeta=[]; saveMetaSync();}
}
function saveMetaSync(){ fs.writeFileSync(META_FILE, JSON.stringify(ticketsMeta,null,2),'utf-8'); }

function vnNowString(){ return new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});}
function genTicketId(){ return `${Date.now()}_${Math.floor(Math.random()*10000)}`;}

// --- TEMP TICKETS ---
const tempTickets = new Map();

// ================== READY ==================
const client = new Client({
  intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials:[Partials.Channel]
});

client.once(Events.ClientReady, async ()=>{
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  loadMeta();

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(()=>null);
  if(!guild) return console.error('Guild not found');

  // Thông báo người bán
  const sellerAnn = guild.channels.cache.get(process.env.SELLER_ANNOUNCE_CHANNEL_ID);
  if(sellerAnn){
    const embed = new EmbedBuilder()
      .setTitle("📦 Nộp đơn hoàn thành")
      .setDescription("Nhấn nút để nộp UID + mô tả đơn hàng.")
      .setColor(0x00AE86);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_seller_ticket').setLabel('🧾 Nộp đơn').setStyle(ButtonStyle.Primary)
    );
    await sellerAnn.send({embeds:[embed],components:[row]}).catch(()=>{});
  }

  // Thông báo người mua
  const buyerAnn = guild.channels.cache.get(process.env.BUYER_ANNOUNCE_CHANNEL_ID);
  if(buyerAnn){
    const embed = new EmbedBuilder()
      .setTitle("🎫 Xem đơn hàng")
      .setDescription("Nhấn nút để nhập UID.")
      .setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_buyer_ticket').setLabel('🔍 Xem đơn').setStyle(ButtonStyle.Success)
    );
    await buyerAnn.send({embeds:[embed],components:[row]}).catch(()=>{});
  }
});

// ================== INTERACTION ==================
client.on(Events.InteractionCreate, async interaction=>{
  try{
    const guild = interaction.guild;
    if(!guild) return;

    // Người bán mở ticket
    if(interaction.isButton() && interaction.customId==='open_seller_ticket'){
      const ch = await guild.channels.create({
        name:`seller-${interaction.user.username}-${Date.now()}`,
        type:ChannelType.GuildText,
        parent: process.env.SELLER_CATEGORY_ID,
        permissionOverwrites:[
          {id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel]},
          {id:interaction.user.id, allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.AttachFiles]}
        ]
      });
      tempTickets.set(interaction.user.id,{type:'seller',channelId:ch.id});
      const modal = new ModalBuilder()
        .setCustomId('seller_modal')
        .setTitle('Nộp đơn hoàn thành')
        .addComponents(
          {type:1,components:[{type:4,custom_id:'uid_input',style:1,label:'UID khách',required:true}]},
          {type:1,components:[{type:4,custom_id:'desc_input',style:2,label:'Mô tả đơn hàng',required:true}]}
        );
      await interaction.showModal(modal);
      return;
    }

    // Người mua mở ticket
    if(interaction.isButton() && interaction.customId==='open_buyer_ticket'){
      const modal = new ModalBuilder()
        .setCustomId('buyer_modal')
        .setTitle('Nhập UID đơn hàng')
        .addComponents(
          {type:1,components:[{type:4,custom_id:'buyer_uid_input',style:1,label:'UID cần xem',required:true}]}
        );
      await interaction.showModal(modal);
      return;
    }

    // --- Modal submit ---
    if(interaction.isModalSubmit()){
      // Người bán
      if(interaction.customId==='seller_modal'){
        await interaction.deferReply({ephemeral:true});
        const uid = interaction.fields.getTextInputValue('uid_input');
        const desc = interaction.fields.getTextInputValue('desc_input');
        const temp = tempTickets.get(interaction.user.id);
        if(!temp) return interaction.editReply({content:'Ticket hết hạn',ephemeral:true});
        const channel = await guild.channels.fetch(temp.channelId).catch(()=>null);
        if(!channel) return interaction.editReply({content:'Không tìm thấy kênh',ephemeral:true});

        const ticketId = genTicketId();
        const meta = {
          id:ticketId, uid, type:'seller', authorId:interaction.user.id,
          createdAtISO:new Date().toISOString(), vnTime:vnNowString(),
          status:'active', desc, channelId:channel.id, guildId:guild.id, images:[]
        };
        ticketsMeta.push(meta);
        saveMetaSync();
        tempTickets.set(interaction.user.id,{...temp,ticketId,uid});

        const embed = new EmbedBuilder()
          .setTitle(`🎫 Thông tin đơn hàng UID: ${uid}`)
          .setColor(0x5865F2)
          .setDescription(`**UID:** \`${uid}\`\n**Mô tả:** ${desc}\n**Người cày:** <@${interaction.user.id}>\n**Kênh sẽ tự động xóa sau 10 phút**`);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('delete_ticket').setLabel('❌ Xóa ngay').setStyle(ButtonStyle.Danger)
        );
        await channel.send({embeds:[embed],components:[row]});
        await interaction.editReply({content:`✅ Ticket đã tạo tại <#${channel.id}>`,ephemeral:true});

        setTimeout(async ()=>{await channel.delete().catch(()=>{});},10*60*1000);
      }

      // Người mua
      if(interaction.customId==='buyer_modal'){
        await interaction.deferReply({ephemeral:true});
        const uid = interaction.fields.getTextInputValue('buyer_uid_input');
        const tickets = ticketsMeta.filter(t=>t.uid===uid && t.type==='seller' && t.status==='active');
        if(tickets.length===0) return interaction.editReply({content:'❌ UID không tồn tại hoặc sai UID',ephemeral:true});

        const ch = await guild.channels.create({
          name:`buyer-${interaction.user.username}-${Date.now()}`,
          type:ChannelType.GuildText,
          parent: process.env.BUYER_CATEGORY_ID,
          permissionOverwrites:[
            {id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel]},
            {id:interaction.user.id, allow:[PermissionFlagsBits.ViewChannel]}
          ]
        });

        for(const t of tickets){
          const embed = new EmbedBuilder()
            .setTitle(`🎫 Thông tin đơn hàng UID: ${t.uid}`)
            .setColor(0x5865F2)
            .setDescription(`**UID:** \`${t.uid}\`\n**Mô tả:** ${t.desc}\n**Người cày:** <@${t.authorId}>`);
          await ch.send({embeds:[embed]});

          for(const img of t.images||[]) await ch.send({files:[img.url]}).catch(()=>{});
        }

        await interaction.editReply({content:`✅ Ticket đã tạo tại <#${ch.id}>`,ephemeral:true});
        setTimeout(async ()=>{await ch.delete().catch(()=>{});},10*60*1000);
      }
    }

    // Xóa ticket
    if(interaction.isButton() && interaction.customId==='delete_ticket'){
      await interaction.reply({content:'Kênh sẽ bị xóa ngay!',ephemeral:true});
      setTimeout(async ()=>{await interaction.channel.delete().catch(()=>{});},1000);
    }

  } catch(err){
    console.error(err);
  }
});

// ================== Upload ảnh lên Cloudinary ==================
client.on(Events.MessageCreate, async msg=>{
  if(msg.author.bot) return;
  const meta = ticketsMeta.find(t=>t.channelId===msg.channelId && t.type==='seller');
  if(!meta) return;

  if(msg.attachments.size>0){
    for(const [_,att] of msg.attachments){
      const uploaded = await cloudinary.uploader.upload(att.url,{
        folder:`tickets/${meta.uid}`,
        resource_type:"image",
        transformation:[{width:1200,quality:"auto"}]
      });
      meta.images.push({url:uploaded.secure_url,public_id:uploaded.public_id,uploadedAt:Date.now()});
    }
    saveMetaSync();
    await msg.channel.send(`✅ Ảnh đã được lưu lên Cloudinary.`);
  }
});

// ================== Xóa ảnh 30 ngày ==================
setInterval(async ()=>{
  const now = Date.now();
  for(const t of ticketsMeta){
    if(!t.images) continue;
    const oldImgs = t.images.filter(img=>now-img.uploadedAt>30*24*60*60*1000);
    for(const img of oldImgs) await cloudinary.uploader.destroy(img.public_id).catch(()=>{});
    t.images = t.images.filter(img=>now-img.uploadedAt<=30*24*60*60*1000);
  }
  saveMetaSync();
},24*60*60*1000);

// --- LOGIN ---
client.login(process.env.DISCORD_TOKEN);

// --- HTTP server chỉ bật trên Render ---
if(process.env.RENDER){
  const http = require('http');
  const PORT = process.env.PORT||3000;
  http.createServer((req,res)=>res.end('ok')).listen(PORT,()=>console.log(`🌐 HTTP server on port ${PORT}`));
}
