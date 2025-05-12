const { Client, Events, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });

client.once(Events.ClientReady, c => {
  console.log(`Ready! (${c.user.tag})`); // 起動した時に"Ready!"とBotの名前をコンソールに出力する
});

client.on(Events.GuildMemberRemove, member => {
  if (member.guild.id !== "1139234314790383779") return; // 指定のサーバー以外では動作しないようにする
  member.guild.channels.cache.get("1160837365263241298").send(`${member.user}さんがサーバーから退出したYO!`);
});

client.on(Events.GuildMemberAdd, member => {
  if (member.guild.id !== "1139234314790383779") return; // 指定のサーバー以外では動作しないようにする
  member.guild.channels.cache.get("1160837365263241298").send(`${member.user}さんがサーバーに参加したYO!`);
});


require('http').createServer((req, res) => res.end('')).listen(3000)

client.login(process.env.BOT_TOKEN);
