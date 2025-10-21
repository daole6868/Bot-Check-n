// ==================== BOT2: Quản lý & thông báo đơn hàng ====================
require('dotenv').config();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, Events, SlashCommandBuilder, REST, Routes
} = require('discord.js');

// ---------- CONFIG ----------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ANNOUNCE_CHANNEL_ID = process.env.ADMIN_ANNOUNCE_CHANNEL_ID;
const ADMIN_CATEGORY_ID = process.env.ADMIN_CATEGORY_ID;
const ADMIN_CHECK_CHANNEL_ID = process.env.ADMIN_CHECK_CHANNEL_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;
const BOT1_TICKET_DIR = process.env.BOT1_TICKET_DIR || '../bot1/data/tickets';
const POLL_INTERVAL_MS = 10 * 1000; // 10 giây

if (!DISCORD_TOKEN || !GUILD_ID || !ADMIN_ANNOUNCE_CHANNEL_ID || !ADMIN_CATEGORY_ID || !ADMIN_CHECK_CHANNEL_ID) {
  console.error('⚠️ Thiếu thông tin trong .env (DISCORD_TOKEN, GUILD_ID, ADMIN_ANNOUNCE_CHANNEL_ID, ADMIN_CATEGORY_ID, ADMIN_CHECK_CHANNEL_ID).');
  process.exit(1);
}

// ---------- FOLDER & FILE ----------
const BOT2_DATA = path.join(__dirname, 'bot2_data');
if (!fs.existsSync(BOT2_DATA)) fs.mkdirSync(BOT2_DATA, { recursive: true });

const SENT_FILE = path.join(BOT2_DATA, 'sent.json');
const HISTORY_LOG = path.join(BOT2_DATA, 'history.log');
let sent = { announced: {} };

// ---------- LOGGING ----------
function writeLog(line) {
  const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const full = `[${time}] ${line}\n`;
  console.log(full.trim());
  try {
    fs.appendFileSync(HISTORY_LOG, full, 'utf-8');
  } catch (e) {
    console.error('❌ Lỗi ghi log:', e);
  }
}

// ---------- TÌM TICKETS.JSON ----------
function ticketsJsonPath() {
  const dir = path.resolve(process.cwd(), BOT1_TICKET_DIR);
  const maybe = path.join(dir, '..', 'tickets.json');
  if (fs.existsSync(maybe)) return maybe;
  const alt = path.resolve(process.cwd(), BOT1_TICKET_DIR);
  if (fs.existsSync(alt) && alt.endsWith('.json')) return alt;
  const fallback = path.join(dir, 'tickets.json');
  return fs.existsSync(fallback) ? fallback : maybe;
}

const TICKETS_JSON = ticketsJsonPath();
const TICKET_FOLDER_ROOT = path.resolve(process.cwd(), BOT1_TICKET_DIR);

// ---------- CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

// ---------- Helpers ----------
function loadSent() {
  if (fs.existsSync(SENT_FILE)) {
    try { sent = JSON.parse(fs.readFileSync(SENT_FILE, 'utf-8')); }
    catch { sent = { announced: {} }; saveSent(); }
  } else saveSent();
}
function saveSent() {
  try { fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2)); }
  catch (e) { writeLog('❌ Lỗi lưu sent.json: ' + e.message); }
}
function readTicketsJson() {
  if (!fs.existsSync(TICKETS_JSON)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(TICKETS_JSON, 'utf-8'));
    return Array.isArray(data) ? data : data.tickets || [];
  } catch (e) {
    writeLog('❌ Lỗi đọc tickets.json: ' + e.message);
    return [];
  }
}
function ticketFolderPath(ticketId) { return path.join(TICKET_FOLDER_ROOT, ticketId); }
function listImagesInFolder(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).map(f => path.join(folder, f));
}
function mkShortTime(iso) {
  try { return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); }
  catch { return iso || 'Không rõ'; }
}

// ---------- Announce Ticket ----------
async function announceTicket(guild, ticket) {
  try {
    const ch = await guild.channels.fetch(ADMIN_ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (!ch) return writeLog('⚠️ Không tìm thấy ADMIN_ANNOUNCE_CHANNEL_ID.');

    const embed = new EmbedBuilder()
      .setTitle(`📦 Đơn hàng mới — UID: ${ticket.uid || 'Không rõ'}`)
      .setColor(0x00AE86)
      .setDescription(ticket.desc || 'Không có mô tả.')
      .addFields(
        { name: 'UID', value: `\`${ticket.uid || 'Không rõ'}\`` },
        { name: 'Người tạo', value: ticket.authorId ? `<@${ticket.authorId}>` : 'Không rõ', inline: true },
        { name: 'Thời gian', value: mkShortTime(ticket.createdAtISO) || 'Không rõ', inline: true }
      )
      .setFooter({ text: `Ticket ID: ${ticket.id}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bot2_open_${ticket.id}`).setLabel('👁️ Mở Ticket').setStyle(ButtonStyle.Primary)
    );

    await ch.send({ embeds: [embed], components: [row] });
    sent.announced[ticket.id] = { announcedAtISO: new Date().toISOString() };
    saveSent();
    writeLog(`📢 Đã thông báo ticket ${ticket.id} (UID: ${ticket.uid})`);
  } catch (e) {
    writeLog('❌ announceTicket error: ' + e.message);
  }
}

// ---------- Open Admin Ticket ----------
async function openAdminTicket(interaction, ticket) {
  try {
    await interaction.deferReply({ flags: 64 });
    const guild = interaction.guild;
    if (!guild) return interaction.editReply({ content: 'Guild không hợp lệ', ephemeral: true });

    const tickets = readTicketsJson();
    const t = tickets.find(x => x.id === ticket.id || x.id === ticket);
    const ticketId = t ? t.id : (typeof ticket === 'string' ? ticket : null);
    if (!ticketId) return interaction.editReply({ content: 'Không tìm thấy ticket', ephemeral: true });

    const folder = ticketFolderPath(ticketId);
    const embed = new EmbedBuilder()
      .setTitle(`📋 Admin Ticket — UID: ${t.uid || 'Không rõ'}`)
      .setColor(0x5865F2)
      .setDescription(t.desc || 'Không có mô tả.')
      .addFields(
        { name: 'UID', value: `\`${t.uid || 'Không rõ'}\`` },
        { name: 'Người tạo', value: t.authorId ? `<@${t.authorId}>` : 'Không rõ', inline: true },
        { name: 'Thời gian', value: mkShortTime(t.createdAtISO) || 'Không rõ', inline: true }
      )
      .setFooter({ text: `Ticket ID: ${ticketId}` });

    const adminCh = await guild.channels.create({
      name: `admin-${t.uid || ticketId}`,
      type: ChannelType.GuildText,
      parent: ADMIN_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...(ADMIN_ROLE_ID ? [{ id: ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }] : [])
      ]
    });

    const delRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bot2_del_${ticketId}`).setLabel('🗑️ Xóa Ticket').setStyle(ButtonStyle.Danger)
    );

    await adminCh.send({ embeds: [embed], components: [delRow] });

    const imgs = listImagesInFolder(folder);
    for (const img of imgs) {
      await adminCh.send({ files: [img] }).catch(e => writeLog('❌ gửi ảnh lỗi: ' + e.message));
    }

    setTimeout(async () => {
      const ch = await guild.channels.fetch(adminCh.id).catch(() => null);
      if (ch && ch.deletable) {
        await ch.delete().catch(() => {});
        writeLog(`⏰ Tự động xóa ticket ${ticketId}`);
      }
    }, 10 * 60 * 1000);

    sent.announced[ticketId] = { ...sent.announced[ticketId], lastOpenedAtISO: new Date().toISOString() };
    saveSent();
    writeLog(`👁️ Admin ${interaction.user.tag} mở ticket ${ticketId} (UID: ${t.uid})`);
    await interaction.editReply({ content: `Đã tạo kênh admin: <#${adminCh.id}>`, ephemeral: true });
  } catch (e) {
    writeLog('❌ openAdminTicket error: ' + e.message);
  }
}

// ---------- Scan Loop ----------
let scanning = false;
async function scanOnce() {
  if (scanning) return;
  scanning = true;
  try {
    if (!fs.existsSync(TICKETS_JSON)) return;
    const tickets = readTicketsJson();
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    for (const t of tickets) {
      if (!t || !t.id) continue;
      if (!sent.announced[t.id]) {
        writeLog(`🕵️ Phát hiện đơn mới ${t.id} (UID: ${t.uid})`);
        await announceTicket(guild, t);
      }
    }
  } catch (e) {
    writeLog('❌ scanOnce error: ' + e.message);
  } finally {
    scanning = false;
  }
}

// ---------- Interaction Handler ----------
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id.startsWith('bot2_open_')) {
        const ticketId = id.replace('bot2_open_', '');
        return openAdminTicket(interaction, ticketId);
      }

      if (id.startsWith('bot2_del_')) {
        const ticketId = id.replace('bot2_del_', '');
        await interaction.deferReply({ flags: 64 });
        const ch = interaction.channel;
        if (ch && ch.deletable) {
          setTimeout(() => ch.delete().catch(() => {}), 800);
          writeLog(`🗑️ Admin ${interaction.user.tag} xóa ticket ${ticketId}`);
        }
        return interaction.editReply({ content: 'Kênh sẽ bị xóa.', ephemeral: true });
      }
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'check') {
      if (interaction.channelId !== ADMIN_CHECK_CHANNEL_ID)
        return interaction.reply({ content: `Chỉ dùng lệnh này trong <#${ADMIN_CHECK_CHANNEL_ID}>`, ephemeral: true });

      await interaction.deferReply({ flags: 64 });
      const uid = interaction.options.getString('uid', true);
      const tickets = readTicketsJson().filter(t => t.uid === uid);

      if (tickets.length === 0)
        return interaction.editReply({ content: `Không tìm thấy đơn UID \`${uid}\``, ephemeral: true });

      for (const t of tickets) {
        const embed = new EmbedBuilder()
          .setTitle(`📦 Đơn hàng — UID: ${t.uid}`)
          .setColor(0x00AE86)
          .setDescription(t.desc || 'Không có mô tả.')
          .addFields(
            { name: 'UID', value: `\`${t.uid}\`` },
            { name: 'Người tạo', value: t.authorId ? `<@${t.authorId}>` : 'Không rõ', inline: true },
            { name: 'Thời gian', value: mkShortTime(t.createdAtISO), inline: true }
          )
          .setFooter({ text: `Ticket ID: ${t.id}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`bot2_open_${t.id}`).setLabel('👁️ Mở Ticket').setStyle(ButtonStyle.Primary)
        );

        await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
      }
      writeLog(`🔎 Admin ${interaction.user.tag} dùng /check UID ${uid}`);
    }
  } catch (e) {
    writeLog('❌ Interaction error: ' + e.message);
  }
});

// ---------- Startup ----------
client.once(Events.ClientReady, async () => {
  writeLog(`🤖 Bot2 online: ${client.user.tag}`);
  loadSent();

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const cmd = new SlashCommandBuilder()
      .setName('check')
      .setDescription('Admin: kiểm tra đơn hàng theo UID')
      .addStringOption(o => o.setName('uid').setDescription('UID cần kiểm tra').setRequired(true))
      .toJSON();
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [cmd] });
    writeLog('✅ Slash command /check đã đăng ký');
  } catch (e) {
    writeLog('❌ Lỗi đăng ký slash: ' + e.message);
  }

  await scanOnce();
  setInterval(scanOnce, POLL_INTERVAL_MS);
});

process.on('unhandledRejection', e => writeLog('unhandledRejection: ' + e.message));
process.on('uncaughtException', e => writeLog('uncaughtException: ' + e.message));

client.login(DISCORD_TOKEN).catch(e => {
  writeLog('❌ Login error: ' + e.message);
  process.exit(1);
});

// thêm vào cuối index.js (nếu muốn chạy như web service)
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('ok')).listen(PORT, () => {
  console.log(`HTTP server listening on ${PORT}`);
});
