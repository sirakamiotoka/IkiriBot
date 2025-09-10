require('dotenv').config();  
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { StreamType } = require('@discordjs/voice');

const express = require('express');
const { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const gTTS = require('gtts');



process.on('uncaughtException', err => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});
// Discordクライアント作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

client.on('error', err => console.error('[Client Error]', err));
client.on('shardError', err => console.error('[Shard Error]', err));
client.on('disconnect', event => console.warn('[Disconnected]', event));
client.on('reconnecting', () => console.log('[Reconnecting]'));

// グローバル変数をサーバーごとに管理
let activeChannels = {};
let voiceConnections = {};
const audioQueue = {};
let isPlaying = {};
let nameMappings = {};
let speakUserName = {}; //07.24
const lastSpeakerInfo = {}; 
// const speechSpeed = {}; //07.29
//08.20
const vcTimeRecording = {}; // guildIdごとにtrue/false
const vcJoinTimes = {};     // guildIdごとにBOTのVC参加時刻
const audioPlayers = {}

/* 08.05
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, TARGET_GUILD_ID),
      { body: ikCommands }
    );
    console.log('Slash commands registered for guild');
  } catch (err) {
    console.error('Slash command registration failed:', err);
  }
});
*/
//08.04↓
// 定義したいスラッシュコマンド一覧

const ikCommands = [
  new SlashCommandBuilder()
    .setName('ik-join')
    .setDescription('VCにぶち込みます。'),

  new SlashCommandBuilder()
    .setName('ik-kill')
    .setDescription('この世のしがらみから解放してあげます。'),

  new SlashCommandBuilder()
    .setName('ik-namespeak')
    .setDescription('名前読み上げの切替を命じます。')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('on または off')
        .setRequired(true)
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' }
        )
    ),
  //08.20
new SlashCommandBuilder()
  .setName('ik-vctimerecording')
  .setDescription('BOTのVC滞在時間を記録します。')
  .addStringOption(option =>
    option.setName('mode')
      .setDescription('on または off')
      .setRequired(true)
      .addChoices(
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' }
      )
  ),
  
  new SlashCommandBuilder()
    .setName('ik-addword')
    .setDescription('読み間違えてる部分を変えてあげます')
    .addStringOption(option =>
      option.setName('間違ってる読み')
        .setDescription('Botが誤読してる読み方')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('正しい読み')
        .setDescription('正しい読み方')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ik-removeword')
    .setDescription('誤読修正単語を木端微塵にします')
    .addStringOption(option =>
      option.setName('読み')
        .setDescription('木端微塵にする読み方')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ik-wordlist')
    .setDescription('登録されている誤読修正一覧を表示します'),

//  new SlashCommandBuilder()
//    .setName('ik-help')
//    .setDescription('助けを乞います'),

].map(cmd => cmd.toJSON());

/*client.on(Events.InteractionCreate, async interaction => {
});*/

const CONFIG_PATH = path.join(__dirname, 'config.json');

// 設定ファイルを読み込む 08.27
function loadServerConfigs() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      serverConfigs = JSON.parse(data);
      console.log('設定ファイルを読み込みました');
    } catch (err) {
      console.error('設定ファイルの読み込みに失敗しました:', err);
    }
  }
}

// 設定ファイルに保存する 08.27
function saveSettings() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serverConfigs, null, 2), 'utf8');
    //console.log('設定ファイルを保存しました');
  } catch (err) {
    console.error('設定ファイルの保存に失敗しました:', err);
  }
}
// テキストのサニタイズ
async function sanitizeText(text, guild) {
  const userMentionRegex = /<@!?(\d+)>/g;
  text = text.replace(userMentionRegex, (match, userId) => {
    const member = guild.members.cache.get(userId);
    return member ? `指名、${member.displayName}、` : '誰か';
  });

  text = text.replace(/[〜～~]/g, 'から');
  return text
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'ゆーあーるえる')
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n.]/gu, '')
    .trim();
}

// テキスト短縮
function shortenText(text, limit = 70) {
  return text.length > limit ? text.slice(0, limit) + ' 以下省略。' : text;
}
function numToKanji(numStr) {
  const map = { '0':'ぜろ','1':'いち','2':'に','3':'さん','4':'よん','5':'ご','6':'ろく','7':'なな','8':'はち','9':'きゅう' };
  return numStr.split('').map(d => map[d] || d).join('');
}

function replaceDotWithTen(text) {
  return text.replace(/(\d+)\.(\d+)/g, (_, intPart, decimalPart) => {
    return `${numToKanji(intPart)}てん${numToKanji(decimalPart)}`;
  });
}
// gTTSで音声生成
async function speakText(text, lang = 'ja', filepath) {
  return new Promise((resolve, reject) => {
    const gtts = new gTTS(text, lang, false);
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

const { spawn } = require('child_process');


 // ffmpegでMP3をリニアPCMに変換し、標準出力のストリームとして返す

function convertToPCMStream(mp3Path) {
  const ffmpeg = spawn(ffmpegPath, [
    '-i', mp3Path,
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-af', 'atempo=1.35',
    'pipe:1'
  ]);

  ffmpeg.stderr.on('data', (data) => {
    // console.log(`ffmpeg stderr: ${data}`); // ←デバッグ時だけ表示
  });

  ffmpeg.on('error', (err) => {
    console.error(`ffmpeg スポーン失敗: ${err.message}`);
  });

  return ffmpeg.stdout;
}


async function convertToPCM(mp3Path, pcmPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(mp3Path)
      .outputOptions([
        '-f s16le',          // リニアPCM
        '-ar 48000',         // サンプリングレート
        '-ac 2'              // ステレオ
      ])
      .audioFilters('atempo=1.35') //07.29追加
      
      .save(pcmPath)
      .on('end', () => resolve(pcmPath))
      .on('error', (err) => {
        console.error('ffmpeg変換エラー:', err);
        reject(err);
      });
  });
}



// 音声再生関数

// 08.27 追加
const queueLocks = {};

async function playNextInQueue(guildId) {
  if (queueLocks[guildId]) return;
  queueLocks[guildId] = true;

  try {
    while (
      audioQueue[guildId] &&
      audioQueue[guildId].length > 0 &&
      voiceConnections[guildId] &&
      voiceConnections[guildId].state.status !== 'destroyed'
    ) {
      const { text, file } = audioQueue[guildId].shift();

      try {
        // gTTSを非同期生成
        await speakText(text, 'ja', file);

        // ffmpegをパイプで変換
        const stream = convertToPCMStream(file);

        // Discordで再生
        const player = createAudioPlayer();
        audioPlayers[guildId] = player;
        const resource = createAudioResource(stream, {
          inputType: StreamType.Raw,
          inlineVolume: true
        });
        resource.volume.setVolume(0.8);
        player.play(resource);

        if (
          voiceConnections[guildId] &&
          voiceConnections[guildId].state.status !== 'destroyed'
        ) {
          voiceConnections[guildId].subscribe(player);
        } else {
          fs.unlink(file, () => {});
          break;
        }

        await new Promise((resolve) => {
          player.once(AudioPlayerStatus.Idle, () => {
            fs.unlink(file, () => {});
            resolve();
          });

          player.once('error', (error) => {
            console.error(`AudioPlayer エラー: ${error.message}`);
            fs.unlink(file, () => {});
            resolve();
          });
        });

      } catch (err) {
        console.error('再生中エラー:', err);
      }
    }
  } catch (err) {
    console.error('playNextInQueue エラー:', err);
  } finally {
    queueLocks[guildId] = false;
  }
}



// 誤読修正
function correctNamePronunciation(name, guildId) {
  const nameMapping = nameMappings[guildId] || {};
  for (const [incorrectName, correctReading] of Object.entries(nameMapping)) {
    if (name.includes(incorrectName)) {
      name = name.replace(incorrectName, correctReading);
    }
  }
  return name;
}

async function leaveVC(guildId, reasonText = '切断されましたわ。') {
  // VC滞在時間のログ
  if (vcTimeRecording[guildId] && vcJoinTimes[guildId]) {
    const joinTime = vcJoinTimes[guildId];
    const durationMs = Date.now() - joinTime;
    const seconds = Math.floor(durationMs / 1000) % 60;
    const minutes = Math.floor(durationMs / (1000 * 60)) % 60;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationString =
      (hours > 0 ? `${hours}時間` : '') +
      (minutes > 0 ? `${minutes}分` : '') +
      `${seconds}秒`;

    const textChannel = client.channels.cache.get(activeChannels[guildId]);
    if (textChannel?.isTextBased()) {
      textChannel.send(`BOTは${durationString}ほどVCで労働させられていましたわ。疲れましたわ。`);
    }

    vcJoinTimes[guildId] = null;
  }

  // 再生中断
  if (audioPlayers[guildId]) {
    try {
      audioPlayers[guildId].stop(true); // trueで現在の再生も止める
    } catch (err) {
      console.warn(`プレイヤー停止エラー: ${err.message}`);
      console.warn(`自動再起動を実行します`);
      process.exit(1); 
    }
  }

  // 残りの未処理ファイル削除
  if (audioQueue[guildId]) {
    for (const item of audioQueue[guildId]) {
      fs.unlink(item.file, err => {
        if (err) {
          console.warn(`未処理ファイル削除失敗: ${item.file} (${err.message})`);
          console.warn(`自動再起動を実行します`);
          process.exit(1); 
        }
      });
    }
    audioQueue[guildId] = [];
  }
  isPlaying[guildId] = false;

  // VC切断
  if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed') {
    voiceConnections[guildId].destroy();
    voiceConnections[guildId] = null;
  }

  // テキスト通知
  if (activeChannels[guildId]) {
    const textChannel = client.channels.cache.get(activeChannels[guildId]);
    if (textChannel?.isTextBased() && reasonText !== '') {
      textChannel.send(reasonText);
    }
    activeChannels[guildId] = null;
  }
}



// Bot起動時
client.once(Events.ClientReady, c => {
  loadServerConfigs(); 
  console.log(`(${c.user.tag}) が起動しましたわ！`);
});

//08.05スラッシュコマンド
  client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, guild, member } = interaction;

  if (!guildId || !guild || !member) {
    await interaction.reply({ content: 'このコマンドはサーバー内でのみ使えますわ。', ephemeral: true });
    return;
  }

  const userId = interaction.user.id;

  const userVC = member.voice?.channel;
  const botVC = guild.members.me?.voice?.channelId;

switch (commandName) {
  case 'ik-join':
    await interaction.deferReply();

    if (voiceConnections[guildId]) {
      await interaction.editReply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
      return;
    }

    if (!userVC) {
      await interaction.editReply('先にお前がVC入ってから言いませんこと？もしかしてアホの御方でございますか？');
      return;
    }

    try {
      voiceConnections[guildId] = joinVoiceChannel({
        channelId: userVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      activeChannels[guildId] = interaction.channelId;
      await interaction.editReply('入ってあげましたわ。');
    } catch (err) {
      console.error('VC参加失敗:', err);
      await interaction.editReply('VCへの参加に失敗しましたわ。');
    }
    break;

  case 'ik-kill':
    await interaction.deferReply();

    if (voiceConnections[guildId]?.state.status !== 'destroyed' && activeChannels[guildId]) {
      if (botVC && userVC?.id === botVC) {
        await interaction.editReply('は？何してくれやがりますの？');
        leaveVC(guildId, '');
      } else {
        await interaction.editReply('同じVCにいない君には命令権限はありませんわｗｗ');
      }
    } else {
      await interaction.editReply('どこにも繋いでないですわねwざんねん！w');
    }
    break;

    //08.20
  case 'ik-vctimerecording': 
  await interaction.deferReply();
  const timermode = interaction.options.getString('mode');
  
  // デフォルト値: 未設定なら true にして保存
  if (vcTimeRecording[guildId] === undefined) {
    vcTimeRecording[guildId] = true;
    saveSettings();
  }

  if (timermode === 'on') {
    if (vcTimeRecording[guildId] === true) {
      await interaction.editReply('既にonですわよ？ｗ');
    } else {
      vcTimeRecording[guildId] = true;
      saveSettings();
      // 現在BOTがVCにいる場合は時間開始
      const botMember = guild.members.me;
      const botVCid = botMember.voice.channelId;
      if (botVCid) {
        vcJoinTimes[guildId] = new Date();
      }
      await interaction.editReply('VC滞在時間の記録を開始しましたわ。');
    }
  } else if (timermode === 'off') {
    vcTimeRecording[guildId] = false;
    vcJoinTimes[guildId] = null;
    saveSettings();
    await interaction.editReply('VC滞在時間の記録を停止しましたわ。');
  } else {
    // 引数がon/off以外
    await interaction.editReply('modeは `on` または `off` を指定してくださいませ。');
  }
  break;


  case 'ik-absolutekill':
    await interaction.deferReply();

    if (userId !== '1289133629972418613') {
      await interaction.editReply('このコマンドは一般階級ユーザーには使えませんわｗｗ');
      return;
    }

    if (voiceConnections[guildId]?.state.status !== 'destroyed' && activeChannels[guildId]) {
      await interaction.editReply('は？強制切断されましたわ。');
      leaveVC(guildId, '');
    } else {
      await interaction.editReply('今はどこにも繋がっていませんわ。');
    }
    break;

  case 'ik-stcheck':
    await interaction.deferReply();

    if (voiceConnections[guildId]?.state) {
      await interaction.editReply(`voiceConnections: ${voiceConnections[guildId].state.status}\nactiveChannel: ${activeChannels[guildId]}`);
    } else {
      await interaction.editReply('状態確認を拒否しますわ');
    }
    break;

  case 'ik-namespeak':
  await interaction.deferReply();

    if (speakUserName[guildId] === undefined) {
    speakUserName[guildId] = true; // デフォルトはON
    saveSettings();
  }
  const mode = interaction.options.getString('mode'); // "on"か"off"
  const current = speakUserName[guildId];

  if ((mode === 'on' && current === true) || (mode === 'off' && current === false)) {
    await interaction.editReply(
      mode === 'on'
        ? 'すでにonになってますわよ？ｗ'
        : 'すでにoffになってますわよ？ｗ'
    );
  } else {
    speakUserName[guildId] = (mode === 'on');
    saveSettings();
    await interaction.editReply(
      mode === 'on'
        ? '名前も呼んであげますわ。光栄に思いなさいｗ'
        : 'もう名前は呼んであげませんわｗ'
    );
  }
  break;


  case 'ik-addword':
    await interaction.deferReply();

    const NGyomi = interaction.options.getString('間違ってる読み');
    const OKyomi = interaction.options.getString('正しい読み');
    if (!nameMappings[guildId]) nameMappings[guildId] = {};
    if (nameMappings[guildId][NGyomi]) {
      await interaction.editReply(`${NGyomi} はすでに登録されてますわボケ。`);
    } else {
      nameMappings[guildId][NGyomi] = OKyomi;
      saveSettings();
      await interaction.editReply(`新しいの登録してやりました、感謝してくださいまし: ${NGyomi} → ${OKyomi}`);
    }
    break;

  case 'ik-removeword':
    await interaction.deferReply();

    const toRemove = interaction.options.getString('読み');
    if (nameMappings[guildId]?.[toRemove]) {
      delete nameMappings[guildId][toRemove];
      await interaction.editReply(`${toRemove} を木端微塵にしてやりましたわｗ感謝しなさいｗｗ`);
    } else {
      await interaction.editReply(`${toRemove} が登録されてないですわね。いい加減にしてくださいませ`);
    }
    break;

  case 'ik-wordlist':
    await interaction.deferReply();

    const mappings = nameMappings[guildId];
    if (!mappings || Object.keys(mappings).length === 0) {
      await interaction.editReply('誤読リストに登録されてる単語がないですわね。ふざけんな。');
    } else {
      const list = Object.entries(mappings)
        .map(([k, v]) => `${k} → ${v}`)
        .join('\n');
      await interaction.editReply(`単語リスト:\n${list}`);
    }
    break;

  case 'ik-help':
    await interaction.deferReply();
    await interaction.editReply('いやですわｗ少しは自分で考えてみたらどうですの？ｗ');
    break;

  default:
    await interaction.deferReply();
    await interaction.editReply('そのコマンドには対応しておりませんわ。');
    break;
}
});


  //08.05end

// メッセージ処理
client.on(Events.MessageCreate, async message => {
  
  if (message.author.bot) return;
  const content = message.content;
  const guildId = message.guild.id;

  if (!speakUserName[guildId]) speakUserName[guildId] = false; // 07.24
  
  if (!nameMappings[guildId]) {
    nameMappings[guildId] = {};
    nameMappings[guildId]['白神'] = 'しらかみ';
  }
/*
07.28コメントアウト
  if (content === '/ik.kill') {
    if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed' && activeChannels[guildId] !== null) {
      leaveVC(guildId, 'は？何してくれやがりますの？');
    } else {
      message.reply('どこにも繋いでないですわねwざんねん！w');
    }
    return;
  }
*/
  // 修正後
if (content === '/ik.kill') {
  const botVC = message.guild.members.me?.voice?.channelId;
  const userVC = message.member.voice?.channelId;

  if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed' && activeChannels[guildId] !== null) {
    if (botVC && botVC === userVC) {
      leaveVC(guildId, 'は？何してくれやがりますの？');
    } else {
      message.reply('同じVCにいない君には命令権限はありませんわｗｗ');
    }
  } else {
    message.reply('どこにも繋いでないですわねwざんねん！w');
  }
  return;
}
  
  if (content === '/ik.absolutekill') {
    const allowedUserId = '1289133629972418613';
    if (message.author.id === allowedUserId) {
      if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed' && activeChannels[guildId] !== null) {
        leaveVC(guildId, 'は？強制切断されましたわ。');
      } else {
        message.reply('今はどこにも繋がっていませんわ。');
      }
    } else {
      message.reply('このコマンドは一般階級ユーザーには使えませんわｗｗ');
    }
    return;
  }

  if (content === '/ik.join') {
    if (voiceConnections[guildId]) {
      message.reply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
      return;
    }
    if (!message.member.voice.channel) {
      message.reply('先にお前がVC入ってから言いませんこと？もしかしてアホの御方でございますか？');
      return;
    }
    voiceConnections[guildId] = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    activeChannels[guildId] = message.channel.id;
    message.reply('入ってあげましたわ。');
    return;
  }

  if (content === '/ik.help') {
    message.reply('いやですわwざまぁww少しは自分でなんとかしたらどうですの？w');
    return;
  }

  if (content === '/ik.stcheck') {
    if (voiceConnections[guildId] && voiceConnections[guildId].state) {
      message.reply('voiceConnectionsの今の状態は ' + voiceConnections[guildId].state.status + ' ですわ');
      message.reply('activeChannelsの今の状態は ' + activeChannels[guildId] + ' ですわ');
    } else {
      message.reply('状態確認を拒否しますわ');
    }
    return;
  }

  if (content === '/ik.w') {
    message.reply('何わらってやがりますの？くたばってくださいませｗ');
    return;
  }

  //08.05
  if (content === '/ik.commandset') {
  if (!guildId) {
    message.reply('このコマンドはサーバー内でのみ使えますわ。');
    return;
  }
    
if (content === '/ik.commandremove') {
  if (!guildId) {
    message.reply('このコマンドはサーバー内でのみ使えますわ。');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  const CLIENT_ID = client.application.id;

  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guildId),
      { body: [] } // ← コマンドリストを空にする
    );

    message.reply(`このサーバー（${message.guild.name}）のコマンドを全部消し飛ばして差し上げましたわｗ`);
  } catch (err) {
    console.error('スラッシュコマンド削除エラー:', err);
    message.reply('削除中にエラーが発生しましたわ。');
  }

  return;
  
}
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
　const CLIENT_ID = client.application.id;
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, guildId),
      { body: ikCommands }
    );

    message.reply(`このサーバー（${message.guild.name}）にコマンドを登録してあげましたわｗ`);
  } catch (err) {
    console.error('スラッシュコマンド登録エラー:', err);
    message.reply('登録中にエラーが発生しましたわ。');
  }
  return;
}//08.05　

  if (content.startsWith('/ik.addword')) {
    const args = content.split(' ').slice(1);
    if (args.length === 2) {
      const [incorrectName, correctReading] = args;
      if (nameMappings[guildId][incorrectName]) {
        message.reply(`${incorrectName} はすでに登録されてますわボケ。`);
      } else {
        nameMappings[guildId][incorrectName] = correctReading;
        message.reply(`新しいの登録してやりました、感謝してくださいまし: ${incorrectName} → ${correctReading}`);
      }
    } else {
      message.reply('正しいコマンドすら入力できないのですか？ｗ　お手本: /ik.addword 白神 しらかみ');
    }
    return;
  }

  if (content.startsWith('/ik.removeword')) {
    const args = content.split(' ').slice(1);
    if (args.length === 1) {
      const [incorrectName] = args;
      if (nameMappings[guildId][incorrectName]) {
        delete nameMappings[guildId][incorrectName];
        message.reply(`${incorrectName} を木端微塵にしてやりましたわｗ感謝しなさいｗｗ`);
      } else {
        message.reply(`${incorrectName} が登録されてないですわね。いい加減にしてくださいませ`);
      }
    } else {
      message.reply('正しいコマンドすら入力できないのですか？ｗ　お手本: /ik.removeword 白神');
    }
    return;
  }

  if (content === '/ik.wordlist') {
    const mappings = nameMappings[guildId];
    if (Object.keys(mappings).length === 0) {
      message.reply('誤読リストに登録されてる単語がないですわね。ふざけんな。');
    } else {
      const list = Object.entries(mappings)
        .map(([incorrectName, correctReading]) => `${incorrectName} → ${correctReading}`)
        .join('\n');
      message.reply(`単語リスト:\n${list}`);
    }
    return;
  }
// 07.24追加
  if (content === '/ik.namespeak on') {
  speakUserName[guildId] = true;
  message.reply('名前も呼んであげますわ。光栄に思いなさいｗ');
  return;
}

if (content === '/ik.namespeak off') {
  speakUserName[guildId] = false;
  message.reply('もう名前は呼んであげませんわw');
  return;
}

   if (content.startsWith('/ik.namespeak')) {
    message.reply('正しいコマンドすら入力できないのですか？ｗ お手本: `/ik.namespeak on` または `/ik.namespeak off`');
    return;
  }
// 07.24追加終了

  /*
// 07.29追加
  if (content.startsWith('/ik.speed')) {
  const args = content.split(' ').slice(1);
  if (args.length !== 1) {
    message.reply(' `/ik.speed 1.0` のように入力してくださいましｗ');
    return;
  }

  const speed = parseFloat(args[0]);
  if (isNaN(speed) || speed < 0.5 || speed > 2.0) {
    message.reply('読み上げ速度は **0.5〜2.0** の範囲で入力してくださいまし');
    return;
  }

  speechSpeed[guildId] = speed;
  message.reply(`読み上げ速度を ${speed} に変更しましたわ`);
  return;
}
  // 07.29追加終了
  */



  
  //  通常メッセージ読み上げ
  if (
    voiceConnections[guildId] &&
    message.channel.id === activeChannels[guildId] &&
    !content.startsWith('/')
  ) {
    //08.05
    
    let text = await sanitizeText(content, message.guild); // ← 修正ポイント
    text = replaceDotWithTen(text);  // 08.05
　　if (message.attachments.size > 0) {
  　text += ` 、添付ファイル`;
　　}
    text = correctNamePronunciation(text, guildId);// 08.05
text = shortenText(text);// 08.05
    if (text.length === 0) return;
    
/* 
07.28修正
    if (speakUserName[guildId]) {
    const speakerName = correctNamePronunciation(message.member?.displayName || message.author.username, guildId);
    text = `${speakerName}、${text}`;
  }
*/

    //07.28追加
    if (speakUserName[guildId]) {
  const speakerId = message.author.id;
  const now = Date.now();

  const last = lastSpeakerInfo[guildId];
  const shouldSpeakName = !last || last.userId !== speakerId || (now - last.timestamp > 20000); 

  if (shouldSpeakName) {
    const speakerName = correctNamePronunciation(message.member?.displayName || message.author.username, guildId);
    text = `${speakerName}、${text}`;
  }

  lastSpeakerInfo[guildId] = { userId: speakerId, timestamp: now };
}
    //追加終了
    
    // 誤読修正の適用
    text = correctNamePronunciation(text, guildId);
    text = shortenText(text);
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `message_${uniqueId}.mp3`);
    
    if (!audioQueue[guildId]) audioQueue[guildId] = [];
    audioQueue[guildId].push({ text, file: filePath });
    playNextInQueue(guildId);
  }
});




// VC出入り読み上げ
client.on('voiceStateUpdate', (oldState, newState) => {
  const botId = client.user.id;
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!guildId) return;

  const isBotUpdate = oldState.id === botId || newState.id === botId;

  // BOTのVC入退室監視
  if (isBotUpdate) {
    // BOTがVCに入った
    if (!oldState.channelId && newState.channelId) {
      vcJoinTimes[guildId] = Date.now();
    }

    // BOTがVCから退出
    if (oldState.channelId && !newState.channelId) {
      const joinTime = vcJoinTimes[guildId];
      if (joinTime) {
        const durationMs = Date.now() - joinTime;
        const seconds = Math.floor(durationMs / 1000) % 60;
        const minutes = Math.floor(durationMs / (1000 * 60)) % 60;
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const durationString =
          (hours > 0 ? `${hours}時間` : '') +
          (minutes > 0 ? `${minutes}分` : '') +
          `${seconds}秒`;

        const textChannel = client.channels.cache.get(activeChannels[guildId]);
        if (textChannel && textChannel.isTextBased()) {
          textChannel.send(`BOTは${durationString}ほどVCで労働させられていましたわ。疲れましたわ。`);
        }
      }

      vcJoinTimes[guildId] = null;
    }
  }

  // BOTが権限者によってVCから蹴られた場合の処理
  if (oldState.id === botId && oldState.channelId && !newState.channelId) {
    leaveVC(guildId, '権限者の仕業か不具合による最適化処理によって木端微塵にされましたわ...');
    return;
  }

  if (!voiceConnections[guildId] || !activeChannels[guildId]) return;

  // Botの現在のVC
  const botMember = newState.guild.members.me;
  const currentVC = botMember?.voice?.channel;
  if (!currentVC) return;

  // Botと同じVCでの出入りのみ読み上げ対象
  if (
    (newState.channelId && newState.channelId !== currentVC.id) &&
    (oldState.channelId && oldState.channelId !== currentVC.id)
  ) {
    return;
  }
 // 追加終了

// 修正後↓
  let text = null;
if (!oldState.channel && newState.channel && newState.channelId === currentVC.id) {
  const member = newState.member || newState.guild.members.cache.get(newState.id);
  const correctedName = correctNamePronunciation(member?.displayName, guildId);
  text = `${correctedName}が侵入しましたわね。`;
} else if (oldState.channel && !newState.channel && oldState.channelId === currentVC.id) {
  const member = oldState.member || oldState.guild.members.cache.get(oldState.id);
  const correctedName = correctNamePronunciation(member?.displayName, guildId);
  text = `${correctedName}がくたばりました。`;
}
  
  
  if (text) {
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `vc_notice_${uniqueId}.mp3`);
    if (!audioQueue[guildId]) audioQueue[guildId] = [];
    audioQueue[guildId].push({ text, file: filePath });
    playNextInQueue(guildId);
  }


  
//ここから↓7/3
if (currentVC) {
  const nonBotMembers = currentVC.members.filter(member => !member.user.bot);
  if (nonBotMembers.size === 0) {
    if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed' && activeChannels[guildId] !== null) {
      if (vcTimeRecording[guildId] && vcJoinTimes[guildId]) {
        const joinTime = vcJoinTimes[guildId];
        const durationMs = Date.now() - joinTime;
        const seconds = Math.floor(durationMs / 1000) % 60;
        const minutes = Math.floor(durationMs / (1000 * 60)) % 60;
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const durationString =
          (hours > 0 ? `${hours}時間` : '') +
          (minutes > 0 ? `${minutes}分` : '') +
          `${seconds}秒`;

        const textChannel = client.channels.cache.get(activeChannels[guildId]);
        if (textChannel && textChannel.isTextBased()) {
          textChannel.send(`BOTは${durationString}ほどVCにいましたわ。お疲れ様ですわ。`);
        }

        vcJoinTimes[guildId] = null; // リセット
      }
      voiceConnections[guildId].destroy();
      voiceConnections[guildId] = null;
      const textChannel = client.channels.cache.get(activeChannels[guildId]);
      if (textChannel && textChannel.isTextBased()) {
        textChannel.send('誰もVCにいなくなったので消滅します');
      }
      activeChannels[guildId] = null;
    }
  }
}
//ここまで↑
});

// Express


const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(port, () => {
  console.log(`✔ Express listening on port ${port}`);
  if (!process.env.BOT_TOKEN) {
    console.error("BOT_TOKEN が .env に設定されていません");
    
  }

  client.login(process.env.BOT_TOKEN).then(() => {
    console.log(" Discord bot ログイン成功");
  }).catch(err => {
    console.error("Discord bot ログイン失敗:", err);
    console.warn(`自動再起動を実行します`);
   process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.warn(`自動再起動を実行します`);
 process.exit(1); 
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.warn(`自動再起動を実行します`);
 process.exit(1);
});


