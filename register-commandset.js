require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const commands = [
  new SlashCommandBuilder()
    .setName('ik.commandset')
    .setDescription('このサーバーにikコマンドを登録してあげますわ')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('コマンドを登録中 (/ik.commandset)...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
      { body: commands }
    );
    console.log('登録完了 (/ik.commandset)');
  } catch (err) {
    console.error('登録エラー:', err);
  }
})();
