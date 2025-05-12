
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const gTTS = require('gtts');
const fs = require('fs');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ] 
});

const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
});

let activeChannel = null;

client.once(Events.ClientReady, c => {
  console.log(`Ready! (${c.user.tag})`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  
  if (message.content === '/sy.dc') {
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    
    connection.destroy();
    activeChannel = null;
    message.reply('ボイスチャンネルから切断しました。');
    return;
  }

  if (message.content === '/sy.join') {
    if (!message.member.voice.channel) {
      message.reply('ボイスチャンネルに接続してから実行してください。');
      return;
    }
    
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    
    activeChannel = message.channel.id;
    message.reply('ボイスチャンネルに接続しました。このチャンネルのメッセージを読み上げます。');
    return;
  }
  
  if (!message.member.voice.channel || message.channel.id !== activeChannel) return;

  try {
    const gtts = new gTTS(message.content, 'ja');
    await new Promise((resolve, reject) => {
      gtts.save('output.mp3', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createAudioResource('output.mp3');
    connection.subscribe(player);
    player.play(resource);
  } catch (error) {
    console.error('Error:', error);
    message.reply('音声の生成中にエラーが発生しました。');
  }
});

client.login(process.env.BOT_TOKEN);
