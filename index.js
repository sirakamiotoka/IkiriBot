const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const gTTS = require('gtts');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// グローバル変数をサーバーごとに管理
let activeChannels = {};  // サーバーごとのactiveChannel
let voiceConnections = {}; // サーバーごとのvoiceConnection
const audioQueue = {};  // サーバーごとのaudioQueue
let isPlaying = {}; // サーバーごとの再生状態

// テキストのサニタイズ
function sanitizeText(text) {
  return text
    .replace(/<a?:\w+:\d+>/g, '') // カスタム絵文字除去
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n]/gu, '') // 記号など除去
    .trim();
}

// テキスト短縮
function shortenText(text, limit = 50) {
  return text.length > limit ? text.slice(0, limit) + ' 以下省略。' : text;
}

// gTTSで音声生成
async function speakText(text, lang = 'ja', filepath) {
  return new Promise((resolve, reject) => {
    const gtts = new gTTS(text, lang, false); // speed固定: false = ノーマル
    gtts.save(filepath, (err) => {
      if (err) {
        console.error('gTTS エラー:', err);
        reject(err);
      } else {
        resolve(filepath);
      }
    });
  });
}

// 音声再生関数をサーバーごとに管理
async function playNextInQueue(guildId) {
  if (isPlaying[guildId] || audioQueue[guildId].length === 0 || !voiceConnections[guildId]) return;

  const { text, file } = audioQueue[guildId].shift();
  isPlaying[guildId] = true;

  try {
    await speakText(text, 'ja', file);
    const player = createAudioPlayer();
    const resource = createAudioResource(file);
    player.play(resource);
    voiceConnections[guildId].subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, (err) => {
        if (err) console.error(`ファイル削除エラー: ${err}`);
      });
      isPlaying[guildId] = false;
      playNextInQueue(guildId); // 次へ
    });
  } catch (err) {
    console.error('読み上げエラー:', err);
    isPlaying[guildId] = false;
    playNextInQueue(guildId); // スキップ
  }
}

// Bot起動時
client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しました！`);
});

// メッセージ処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const content = message.content;
  const guildId = message.guild.id;

  if (content === '/ik.kill') {
    if (voiceConnections[guildId]) {
      voiceConnections[guildId].destroy();
      voiceConnections[guildId] = null;
      activeChannels[guildId] = null;
      message.reply('は？何してくれてんの？');
    } else {
      message.reply('どこにも繋いでないねwざんねん！w');
    }
    return;
  }

  if (content === '/ik.join') {
    if (voiceConnections[guildId]) {
      message.reply('もう入ってるやんｗ目ぇついてますか？ｗｗｗ');
      return;
    }

    if (!message.member.voice.channel) {
      message.reply('先にお前がVC入ってから言えや。もしかしてアホですか？');
      return;
    }
    voiceConnections[guildId] = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    activeChannels[guildId] = message.channel.id;
    message.reply('入った。だる。');
    return;
  }

  if (content === '/ik.help') {
    message.reply('教えませーんwざまぁww少しは自分でなんとかしたら？w');
    return;
  }

  if (content === '/ik.w') {
    message.reply('何わろとんねん死んでくれ');
    return;
  }

  if (content === '/ik.konamon') {
    message.reply('ちんちん交通整備魂');
    return;
  }

  if (content === '/ik.tntn') {
    message.reply('こなもんのヤり抜くっ!!');
    return;
  }

  // 通常メッセージ読み上げ
  if (voiceConnections[guildId] && message.channel.id === activeChannels[guildId] && !content.startsWith('/')) {
    let text = sanitizeText(content);
    if (text.length === 0) return;
    text = shortenText(text);
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `message_${uniqueId}.mp3`);
    
    if (!audioQueue[guildId]) audioQueue[guildId] = [];
    audioQueue[guildId].push({ text, file: filePath });
    playNextInQueue(guildId);
  }
});

// VCの出入りを読み上げ
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = newState.guild.id;
  if (!voiceConnections[guildId] || !activeChannels[guildId]) return;

  let text = null;
  if (!oldState.channel && newState.channel) {
    text = `${newState.member.displayName}が侵入しよった。`;
  } else if (oldState.channel && !newState.channel) {
    text = `${oldState.member.displayName}が消滅した。`;
  }

  if (text) {
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `vc_notice_${uniqueId}.mp3`);
    if (!audioQueue[guildId]) audioQueue[guildId] = [];
    audioQueue[guildId].push({ text, file: filePath });
    playNextInQueue(guildId);
  }

  const channel = voiceConnections[guildId].joinConfig.channelId
    ? newState.guild.channels.cache.get(voiceConnections[guildId].joinConfig.channelId)
    : null;

  if (channel) {
    const nonBotMembers = channel.members.filter(member => !member.user.bot);
    if (nonBotMembers.size === 0) {
      voiceConnections[guildId].destroy();
      voiceConnections[guildId] = null;

      const textChannel = client.channels.cache.get(activeChannels[guildId]);
      if (textChannel && textChannel.isTextBased()) {
        textChannel.send('誰もVCにいなくなったので自害します');
      }

      activeChannels[guildId] = null;
    }
  }
});

// Expressサーバー（常駐用）
const app = express();
app.get('/', (req, res) => {
  res.send('Bot is running!');
});
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Discordログイン
client.login(process.env.BOT_TOKEN);
