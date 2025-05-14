const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const https = require('https');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});
let activeChannel = null;
let voiceConnection = null;
const audioQueue = []; // 読み上げキュー
let isPlaying = false;
const globalSpeed = 1.2; // 固定速度
function sanitizeText(text) {
  return text
    .replace(/<a?:\w+:\d+>/g, '') // カスタム絵文字
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n]/gu, '') // 記号や絵文字を除去
    .trim();
}
function shortenText(text, limit = 50) {
  return text.length > limit ? text.slice(0, limit) + ' 以下省略。' : text;
}
async function speakText(text, lang = 'ja', speed = 1.2, filepath = './message.mp3') {
  const url = googleTTS.getAudioUrl(text, {
    lang,
    slow: false,
    host: 'https://translate.google.com',
    speed,
  });
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(filepath)));
    }).on('error', err => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}
async function playNextInQueue() {
  if (isPlaying || audioQueue.length === 0 || !voiceConnection) return;
  const { text, file } = audioQueue.shift();
  isPlaying = true;
  try {
    await speakText(text, 'ja', globalSpeed, file);
    const player = createAudioPlayer();
    const resource = createAudioResource(file);
    player.play(resource);
    voiceConnection.subscribe(player);
    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, () => {});
      isPlaying = false;
      playNextInQueue(); // 次の音声へ
    });
  } catch (err) {
    console.error('読み上げエラー:', err);
    isPlaying = false;
    playNextInQueue(); // エラー時もスキップして次へ
  }
}
client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しました！`);
});
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  const content = message.content;
  // === コマンド処理（VC接続/切断/ヘルプ） ===
  if (content === '!ik.kill') {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      activeChannel = null;
      message.reply('は？何してくれてんの？');
    } else {
      message.reply('どこにも繋いでないねwざんねん！w');
    }
    return;
  }
  if (content === '!ik.join') {
    if (!message.member.voice.channel) {
      message.reply('先にお前がVC入ってから言えや。もしかしてアホですか？');
      return;
    }
    voiceConnection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    activeChannel = message.channel.id;
    message.reply('入った。だる。');
    return;
  }
  if (content === '!ik.help') {
    message.reply('教えませーんwざまぁwww');
    return;
  }
if (content === '!ik.konamon') {
    message.reply('ちんちん交通整備魂');
    return;
  }
  // === 読み上げ処理（コマンド以外） ===
  if (voiceConnection && message.channel.id === activeChannel && !content.startsWith('/')) {
    let text = sanitizeText(content);
    text = shortenText(text);
    audioQueue.push({ text, file: './message.mp3' });
    playNextInQueue();
  }
});
client.on('voiceStateUpdate', (oldState, newState) => {
  if (!voiceConnection || !activeChannel) return;
  let text = null;
  if (!oldState.channel && newState.channel) {
    text = `${newState.member.displayName}が侵入しよった。`;
  } else if (oldState.channel && !newState.channel) {
    text = `${oldState.member.displayName}が消滅した。`;
  }
  if (text) {
    audioQueue.push({ text, file: './vc_notice.mp3' });
    playNextInQueue();
  }
});
const express = require('express');
const app = express();
// 任意のエンドポイント（Uptime Robotがpingを送る場所）
app.get('/', (req, res) => {
  res.send('Bot is running!');
});
// ポートの設定（Replitではポートは自動的に決まる）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
client.login(process.env.BOT_TOKEN);
