const { Client, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const https = require('https');
const path = require('path');

// Google Cloudのクライアント設定
const client = new textToSpeech.TextToSpeechClient({
  keyFilename: path.join(__dirname, 'credentials.json'), // サービスアカウントのJSONファイル
});

const clientDiscord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

//実験
// コマンド定義
const commands = [
  {
    name: 'join',
    description: '何がなんでもVCに凸ります',
  },
  {
    name: 'kill',
    description: 'いきってるBOTを抹消します',
  },
  {
    name: 'help',
    description: '助けを乞います',
  }
];



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

// Google Cloud Text-to-Speech APIで音声合成
async function speakText(text, lang = 'ja-JP', speed = 1.2, filepath = './message.mp3') {
  const request = {
    input: { text },
    voice: { languageCode: lang, ssmlGender: 'NEUTRAL' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
  };

  try {
    const [response] = await client.synthesizeSpeech(request);
    fs.writeFileSync(filepath, response.audioContent, 'binary');
    console.log('Audio content written to file:', filepath);
    return filepath;
  } catch (err) {
    console.error('音声合成エラー:', err);
    throw err;
  }
}

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

clientDiscord.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しました！`);
});

clientDiscord.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const content = message.content;
  let guildId = null;
  
  // Bot自身のクライアントIDを取得
  const clientId = "1160889969313841152";
  
  // === コマンド処理（/ik.setcommand） ===
  if (content.startsWith('/ik.setcommand')) {
    // コマンドが送られたサーバーIDを取得
    guildId = message.guild.id; // メッセージが送信されたサーバーのID
    
    

    // guildIdを使って何か処理を行う（ここではコンソールに出力）
    console.log(`Command received in guild: ${guildId}`);
    
    // 返答メッセージを送信
    message.reply(`${guildId} に追加してやったぞ。有難く思えｗ`);
    return;
  }
// RESTクライアントを作成
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

// コマンドをDiscordに登録する処理
(async () => {
  try {
    console.log('コマンド辞書登録');

    // コマンドをDiscordサーバーに登録
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();
// === コマンド処理（VC接続/切断/ヘルプ） ===
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
    message.reply('いやでーすwざまぁww少しは自分でなんとかしたら？w');
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

  // === 読み上げ処理（コマンド以外） ===
  if (voiceConnection && message.channel.id === activeChannel && !content.startsWith('/')) {
    let text = sanitizeText(content);
    if (text.length === 0) return; // 画像・スタンプ・記号のみは無視
    text = shortenText(text);
    audioQueue.push({ text, file: './message.mp3' });
    playNextInQueue();
  }
});

clientDiscord.on('voiceStateUpdate', (oldState, newState) => {
  if (!voiceConnection || !activeChannel) return;

  // ユーザーの出入りアナウンス
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

clientDiscord.login(process.env.BOT_TOKEN);

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(3000, () => {
  console.log(`Server is running at: https://ikiriBOT.up.railway.app:${3000}`);
});

console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? '[OK]' : '[NOT FOUND]');
