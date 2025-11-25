// --- Discord Bot ---
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const Database = require('better-sqlite3');#####################
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.on("ready", () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
});

client.login(process.env.TOKEN);

#####################################
// --- Database ---
const db = new Database('./voice_time.db');

db.exec(`
CREATE TABLE IF NOT EXISTS totals (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, guild_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  start_timestamp INTEGER NOT NULL,
  PRIMARY KEY(user_id, guild_id)
);
`);

const getSession = db.prepare("SELECT * FROM sessions WHERE user_id=? AND guild_id=?");
const insertSession = db.prepare("INSERT OR IGNORE INTO sessions(user_id,guild_id,start_timestamp) VALUES (?,?,?)");
const deleteSession = db.prepare("DELETE FROM sessions WHERE user_id=? AND guild_id=?");
const addTotal = db.prepare(`
  INSERT INTO totals(user_id, guild_id, total_seconds)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id, guild_id) DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds
`);
const getTotal = db.prepare("SELECT total_seconds FROM totals WHERE user_id=? AND guild_id=?");
const getTop = db.prepare("SELECT * FROM totals WHERE guild_id=? ORDER BY total_seconds DESC LIMIT 10");

// --- Time format ---
function format(sec) {
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600); sec %= 3600;
  const m = Math.floor(sec / 60); sec %= 60;
  return `${d ? d+"d " : ""}${h ? h+"h " : ""}${m ? m+"m " : ""}${sec}s`;
}

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// --- Slash commands ---
const commands = [
  new SlashCommandBuilder().setName("mytime").setDescription("Montre ton temps passé en vocal."),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Classement des utilisateurs par temps vocal."),
].map(c => c.toJSON());

// --- Bot ready ---
client.once("ready", async () => {
  console.log("Bot connecté en tant que " + client.user.tag);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("Commandes slash chargées.");
  }
});

// --- Voice tracking ---
client.on("voiceStateUpdate", (oldS, newS) => {
  const g = newS.guild.id;
  const u = newS.id;

  const left = oldS.channelId && !newS.channelId;
  const join = !oldS.channelId && newS.channelId;

  if (join) insertSession.run(u, g, Math.floor(Date.now() / 1000));

  if (left) {
    const s = getSession.get(u, g);
    if (s) {
      const now = Math.floor(Date.now() / 1000);
      const delta = now - s.start_timestamp;
      addTotal.run(u, g, delta);
      deleteSession.run(u, g);
    }
  }
});

// --- Slash commands handling ---
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const g = i.guildId;
  const u = i.user.id;

  if (i.commandName === "mytime") {
    const base = getTotal.get(u, g)?.total_seconds || 0;
    const s = getSession.get(u, g);
    const extra = s ? Math.floor(Date.now()/1000) - s.start_timestamp : 0;
    return i.reply(`⏱️ Tu as passé **${format(base + extra)}** en vocal !`);
  }

  if (i.commandName === "leaderboard") {
    const top = getTop.all(g);
    if (!top.length) return i.reply("Personne n'a encore parlé en vocal.");
    let msg = "🏆 **Leaderboard Vocal**\n\n";
    let r = 1;
    for (const t of top) {
      const member = await i.guild.members.fetch(t.user_id).catch(() => null);
      const name = member?.user?.tag || t.user_id;
      msg += `**#${r}** — ${name} : ${format(t.total_seconds)}\n`;
      r++;
    }
    return i.reply(msg);
  }
});

// --- Login (correct placement) ---
client.login(process.env.DISCORD_TOKEN);
