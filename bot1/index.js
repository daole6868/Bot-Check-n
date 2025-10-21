require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, Events, ChannelType, PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch})=>fetch(...args));

// --- FOLDER DATA ---
const DATA_DIR = path.join(__dirname,'data');
const TICKET_DIR = path.join(DATA_DIR,'tickets');
const META_FILE = path.join(DATA_DIR,'tickets.json');
for(const d of [DATA_DIR,TICKET_DIR]) if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});

// --- DISCORD CLIENT ---
const client = new Client({
  intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials:[Partials.Channel]
});

// --- LOAD META ---
let ticketsMeta = [];
function loadMeta(){
  if(fs.existsSync(META_FILE)){
    try{ ticketsMeta = JSON.parse(fs.readFileSync(META_FILE,'utf-8')); }
    catch(e){ console.error('Parse meta error',e); ticketsMeta=[]; saveMetaSync(); }
  } else { ticketsMeta=[]; saveMetaSync(); }
}
function saveMetaSync(){ fs.writeFileSync(META_FILE, JSON.stringify(ticketsMeta,null,2),'utf-8'); }
function vnNowString(){ return new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}); }
function genTicketId(){ return `${Date.now()}_${Math.floor(Math.random()*10000)}`; }

const tempTickets = new Map(); // lưu tạm user mở ticket

// ================== READY ==================
client.once(Events.ClientReady, async ()=>{
  console.log(`Bot1 logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(()=>null);
  if(!guild) return console.error('Guild not found');

  // --- thông báo nút cho người bán ---
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

  // --- thông báo nút cho người mua ---
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

  loadMeta();
});

// ================== INTERACTION ==================
client.on(Events.InteractionCreate, async interaction=>{
  try{
    const guild = interaction.guild;
    if(!guild) return;

    // --- Người bán mở ticket ---
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
          {type:1, components:[{type:4,custom_id:'uid_input',style:1,label:'UID khách',required:true}]},
          {type:1, components:[{type:4,custom_id:'desc_input',style:2,label:'Mô tả đơn hàng',required:true}]}
        );
      try{ await interaction.showModal(modal); } catch(e){ console.error('Error showing modal:', e); }
      return;
    }

    // --- Người mua mở ticket ---
    if(interaction.isButton() && interaction.customId==='open_buyer_ticket'){
      const modal = new ModalBuilder()
        .setCustomId('buyer_modal')
        .setTitle('Nhập UID đơn hàng')
        .addComponents(
          {type:1,components:[{type:4,custom_id:'buyer_uid_input',style:1,label:'UID cần xem',required:true}]}
        );
      try{ await interaction.showModal(modal); } catch(e){ console.error('Error showing modal:', e); }
      return;
    }

    // --- MODAL SUBMIT ---
    if(interaction.isModalSubmit()){
      // --- Người bán submit ---
      if(interaction.customId==='seller_modal'){
        await interaction.deferReply({ephemeral:true});
        const uid = interaction.fields.getTextInputValue('uid_input');
        const desc = interaction.fields.getTextInputValue('desc_input');
        const temp = tempTickets.get(interaction.user.id);
        if(!temp) return interaction.editReply({content:'Ticket hết hạn',ephemeral:true});
        const channel = await guild.channels.fetch(temp.channelId).catch(()=>null);
        if(!channel) return interaction.editReply({content:'Không tìm thấy kênh',ephemeral:true});

        const ticketId = genTicketId();
        const folder = path.join(TICKET_DIR,ticketId);
        await fsp.mkdir(folder,{recursive:true});
        await fsp.writeFile(path.join(folder,'desc.txt'),desc,'utf-8');

        const meta = {id:ticketId, uid, type:'seller', authorId:interaction.user.id, createdAtISO:new Date().toISOString(), vnTime:vnNowString(), folder, status:'active', desc, channelId:channel.id, guildId:guild.id};
        ticketsMeta.push(meta);
        saveMetaSync();
        tempTickets.set(interaction.user.id,{...temp,ticketId,uid});

        const embed = new EmbedBuilder()
          .setTitle(`🎫 Thông tin đơn hàng UID: ${uid}`)
          .setColor(0x5865F2)
          .setDescription(
            `**UID:** \`${uid}\`\n` +
            `**Nội Dung:** ${desc || 'Không có'}\n` +
            `**Người cày:** <@${interaction.user.id}>\n` +
            `**Nếu phát hiện đơn hàng bị thếu hoặc có vấn đề, vui lòng liên hệ admin để được giải quyết sớm nhất.**\n` +
            `**🔴 KÊNH SẼ TỰ ĐỘNG XÓA SAU 10 PHÚT**`
          );
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('delete_ticket').setLabel('❌ Xóa ngay').setStyle(ButtonStyle.Danger)
        );
        await channel.send({embeds:[embed],components:[row]});
        const sellerAnn = await guild.channels.fetch(process.env.SELLER_ANNOUNCE_CHANNEL_ID).catch(()=>null);
        if(sellerAnn) await sellerAnn.send(`✅ Ticket đã tạo cho <@${interaction.user.id}> tại <#${channel.id}>`);
        interaction.editReply({content:`✅ Ticket đã tạo thành công tại <#${channel.id}>`,ephemeral:true});

        // Tự xóa sau 10 phút
        setTimeout(async ()=>{ await channel.delete().catch(()=>{}); }, 10*60*1000);
      }

      // --- Người mua submit ---
      if(interaction.customId==='buyer_modal'){
        await interaction.deferReply({ephemeral:true});
        const uid = interaction.fields.getTextInputValue('buyer_uid_input');

        const tickets = ticketsMeta.filter(t=>t.uid===uid && t.type==='seller' && t.status==='active')
                                   .sort((a,b)=>new Date(a.createdAtISO)-new Date(b.createdAtISO));
        if(tickets.length === 0) return interaction.editReply({content:`❌ UID không tồn tại hoặc sai UID`, ephemeral:true});

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
            .setDescription(
              `**UID:** \`${t.uid}\`\n` +
              `**Nội Dung:** ${t.desc || 'Không có'}\n` +
              `**Người cày:** <@${t.authorId}>\n` +
              `**Nếu phát hiện đơn hàng bị thếu hoặc có vấn đề, vui lòng liên hệ admin để được giải quyết sớm nhất.**\n` +
              `**🔴 KÊNH SẼ TỰ ĐỘNG XÓA SAU 10 PHÚT**`
            );
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('delete_ticket').setLabel('❌ Xóa ngay').setStyle(ButtonStyle.Danger)
          );
          await ch.send({embeds:[embed],components:[row]});

          // Gửi ảnh nếu có
          if(fs.existsSync(t.folder)){
            const files = fs.readdirSync(t.folder).filter(f=>/\.(jpg|jpeg|png|gif|webp)$/i.test(f));
            for(const f of files){
              await ch.send({files:[path.join(t.folder,f)]}).catch(()=>{});
            }
          }
        }

        const buyerAnn = await guild.channels.fetch(process.env.BUYER_ANNOUNCE_CHANNEL_ID).catch(()=>null);
        if(buyerAnn) await buyerAnn.send(`✅ Ticket đã tạo cho <@${interaction.user.id}> tại <#${ch.id}>`);
        interaction.editReply({content:`✅ Ticket đã tạo tại <#${ch.id}>`,ephemeral:true});

        // Xóa kênh sau 10 phút
        setTimeout(async ()=>{ await ch.delete().catch(()=>{}); }, 10*60*1000);
      }
    }

    // --- Xử lý nút xóa ticket ---
    if(interaction.isButton() && interaction.customId==='delete_ticket'){
      const channel = interaction.channel;
      await interaction.reply({content:'Kênh sẽ bị xóa ngay!',ephemeral:true});
      setTimeout(async ()=>{ await channel.delete().catch(()=>{}); },1000);
    }

  }catch(err){
    console.error(err);
    if(interaction && !interaction.replied && !interaction.deferred){
      interaction.reply({content:'Có lỗi xảy ra',ephemeral:true}).catch(()=>{});
    }
  }
});

// ================== LƯU ẢNH NGƯỜI BÁN ==================
client.on(Events.MessageCreate, async msg=>{
  if(msg.author.bot) return;
  const meta = ticketsMeta.find(t=>t.channelId===msg.channelId && t.type==='seller');
  if(!meta) return;

  if(msg.attachments.size>0){
    const folder = meta.folder;
    for(const [_,att] of msg.attachments){
      const filePath = path.join(folder,att.name);
      const res = await fetch(att.url);
      const buffer = await res.arrayBuffer();
      await fsp.writeFile(filePath,Buffer.from(buffer));
    }
    await msg.channel.send(`✅ Ảnh đã được lưu thành công.`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('delete_ticket').setLabel('❌ Xóa ngay').setStyle(ButtonStyle.Danger)
    );
    await msg.channel.send({content:'Bạn có thể xóa kênh ngay:',components:[row]});
  }
});

// --- LOGIN ---
client.login(process.env.DISCORD_TOKEN);

// thêm vào cuối index.js (nếu muốn chạy như web service)
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('ok')).listen(PORT, () => {
  console.log(`HTTP server listening on ${PORT}`);
});
