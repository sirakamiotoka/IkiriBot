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
    name: 'ik_join',
    description: '何がなんでもVCに凸ります(/コマンドからは作成中)',
  },
  {
    name: 'ik_kill',
    description: 'いきってるBOTを抹消します(/コマンドからは作成中)',
  },
  {
    name: 'ik_help',
    description: '助けを乞います(/コマンドからは作成中)',
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
  
  // RESTクライアントを作成
　const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  if (content === '!ik_commandset') {
  let guildId = message.guild.id; // メッセージが送信されたサーバーのID
  const clientId = clientDiscord.user.id; // Bot自身のclientIdを動的に取得

  if (!guildId) {
    return message.reply('サーバーIDが取得できませんでした。');
  }
try {
  
    console.log('コマンドを辞書登録します');

    // コマンドをDiscordサーバーに登録
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });

    message.reply(`これで貸し１つだねｗ`);
  } catch (error) {
    console.error('コマンド登録エラー:', error);
    message.reply('登録に失敗したわ。ふざけんな。');
  }
    return;
}


// コマンド処理 (Interaction)
clientDiscord.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  // === コマンド処理（VC接続/切断/ヘルプ） ===
  if (commandName === 'ik_kill') {
    if (voiceConnection) {
      voiceConnection.destroy();
      activeChannel = null;
      interaction.reply('は？何してくれてんの？');
    } else {
      interaction.reply('どこにも繋いでないねwざんねん！w');
    }
    return;
  }

  if (commandName === 'ik_join') {
    if (!interaction.member.voice.channel) {
      interaction.reply('先にお前がVC入ってから言えや。もしかしてアホですか？');
      return;
    }
    voiceConnection = joinVoiceChannel({
      channelId: interaction.member.voice.channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    activeChannel = interaction.channel.id;
    interaction.reply('入った。だる。');
    return;
  }

  if (commandName === 'ik_help') {
    interaction.reply('いやだねwざまぁww少しは自分でなんとかしたら？w');
    return;
  }
});
  //メッセージで受け取った場合
  if (content === '!ik.kill') {
    if (voiceConnection) {
      voiceConnection.destroy();
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
    message.reply('いやだねwざまぁww少しは自分でなんとかしたら？w');
    return;
  }


  //辞書には関係なしコマンド
  if (content === '!ik.w') {
    message.reply('何わろとんねん死んでくれ');
    return;
  }

  if (content === '!ik.konamon') {
    message.reply('ちんちん交通整備魂');
    return;
  }

  if (content === '!ik.tntn') {
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
