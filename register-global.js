const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder().setName('ik.commandset').setDescription('このサーバーにコマンドを登録してあげますわよ。')
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('コマンド登録中...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('登録成功！');
  } catch (error) {
    console.error('登録失敗:', error);
  }
})();
