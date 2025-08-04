import { config } from 'dotenv';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

config();

const commands = [
  new SlashCommandBuilder().setName('ik.commandset').setDescription('このサーバーにコマンドを登録してあげますわよ。').toJSON()
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
