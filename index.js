
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { createWriteStream } = require('fs');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ] 
});

client.once(Events.ClientReady, c => {
  console.log(`Ready! (${c.user.tag})`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  
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
    
    message.reply('ボイスチャンネルに接続しました。');
    return;
  }
  
  if (!message.member.voice.channel) return;

  // 音声を生成
  const text = message.content;
  const audioPlayer = createAudioPlayer();
  
  // Open JTalkを使用して音声合成
  const openjtalk = spawn('open_jtalk', [
    '-x', '/usr/local/dic',
    '-m', '/usr/share/hts-voice/mei/mei_normal.htsvoice',
    '-ow', 'output.wav'
  ]);

  openjtalk.stdin.write(text);
  openjtalk.stdin.end();

  openjtalk.on('close', () => {
    // ボイスチャンネルに接続
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    // 音声を再生
    const resource = createAudioResource('output.wav');
    connection.subscribe(audioPlayer);
    audioPlayer.play(resource);
  });
});

require('http').createServer((req, res) => res.end('')).listen(3000);

client.login(process.env.BOT_TOKEN);
