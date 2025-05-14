// 必要なモジュールのインポート
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const textToSpeech = require('@google-cloud/text-to-speech');
const util = require('util');

// Google Cloud Text-to-Speech クライアントの初期化
const ttsClient = new textToSpeech.TextToSpeechClient();

// Discordクライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// グローバル変数の定義
let activeChannel = null;
let voiceConnection = null;
const audioQueue = [];
let isPlaying = false;
const globalSpeed = 1.2; // 読み上げ速度

// テキストのサニタイズ
function sanitizeText(text) {
  return text
    .replace(/<a?:\w+:\d+>/g, '') // カスタム絵文字の除去
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n]/gu, '') // 記号や絵文字の除去
    .trim();
}

// テキストの短縮
function shortenText(text, limit = 50) {
  return text.length > limit ? text.slice(0, limit) + ' 以下省略。' : text;
}

// テキストを音声に変換し、MP3ファイルとして保存
async function speakText(text, lang = 'ja-JP', speed = 1.2, filepath) {
  const request = {
    input: { text },
    voice: {
      languageCode: lang,
      ssmlGender: 'NEUTRAL',
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speed,
    },
  };

  try {
    const [response] = await ttsClient.synthesizeSpeech(request);
    const writeFile = util.promisify(fs.writeFile);
    await writeFile(filepath, response.audioContent, 'binary');
    return filepath;
  } catch (err) {
    console.error('音声合成エラー:', err);
    throw err;
  }
}

// キュー内の次の音声を再生
async function playNextInQueue() {
  if (isPlaying || audioQueue.length === 0 || !voiceConnection) return;

  const { text, file } = audioQueue.shift();
  isPlaying = true;

  try {
    await speakText(text, 'ja-JP', globalSpeed, file);
    const player = createAudioPlayer();
    const resource = createAudioResource(file);
    player.play(resource);
    voiceConnection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, (err) => {
        if (err) console.error(`ファイル削除エラー: ${err}`);
      });
      isPlaying = false;
      playNextInQueue(); // 次の音声へ
    });
  } catch (err) {
    console.error('読み上げエラー:', err);
    isPlaying = false;
    playNextInQueue(); // エラー時もスキップして次へ
  }
}

// Botの準備完了時の処理
client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しました！`);
});

// メッセージ受信時の処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const content = message.content;

  // コマンド処理
  if (content === '/ik.kill') {
    if (voiceConnection) {
      voiceConnection.destroy();
      activeChannel = null;
      message.reply('は？何してくれてんの？');
    } else {
      message.reply('どこにも繋いでないねwざんねん！w');
    }
    return;
  }

  if (content === '/ik.join') {
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

  // 読み上げ処理（コマンド以外）
  if (voiceConnection && message.channel.id === activeChannel && !content.startsWith('/')) {
    let text = sanitizeText(content);
    if (text.length === 0) return; // 画像・スタンプ・記号のみは無視
    text = shortenText(text);
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `message_${uniqueId}.mp3`);
    audioQueue.push({ text, file: filePath });
    playNextInQueue();
  }
});

// ボイスチャンネルの状態更新時の処理
client.on('voiceStateUpdate', (oldState, newState) => {
  if (!voiceConnection || !activeChannel) return;

  // ユーザーの出入りアナウンス
  let text = null;
  if (!oldState.channel && newState.channel) {
    text = `${newState.member.displayName}が侵入しよった。`;
  } else if (oldState.channel && !newState.channel) {
    text = `${oldState.member.displayName}が消滅した。`;
  }

  if (text) {
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `vc_notice_${uniqueId}.mp3`);
    audioQueue.push({ text, file: filePath });
    playNextInQueue();
  }

  // VCにBot以外の人がいなければ自動切断＆メッセージ送信
  const channel = voiceConnection.joinConfig.channelId
    ? newState.guild.channels.cache.get(voiceConnection.joinConfig.channelId)
    : null;

  if (channel) {
    const nonBotMembers = channel.members.filter(member => !member.user.bot);
    if (nonBotMembers.size === 0) {
      voiceConnection.destroy();
      voiceConnection = null;

      const textChannel = client.channels.cache.get(activeChannel);
      if (textChannel && textChannel.isTextBased()) {
        textChannel.send('誰もVCにいなくなったので自害します');
      }

      activeChannel = null;
    }
  }
});

// Expressで常駐化（Replitなどで使用）
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Your app is available at: https://your-replit-username.repl.co`);
});

// Discord Botのログイン
client.login(process.env.BOT_TOKEN);
