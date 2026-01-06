// index.js — Map 統一版（VC / 再生まわりのみ Map 化）
// 元ファイル参照: :contentReference[oaicite:1]{index=1}

const voiceConnections = new Map(); // guildId -> VoiceConnection
const audioPlayers = new Map();     // guildId -> AudioPlayer
const audioQueue = new Map();       // guildId -> [{text, file}, ...]
process.on('SIGINT', async () => {
  console.log('[SIGINT] 終了処理を開始します...');

  try {
    // --- AudioPlayer の停止 ---
    if (audioPlayers instanceof Map) {
      for (const player of audioPlayers.values()) {
        try {
          // player.stop(true) を呼べる場合はそのまま
          try { player.stop(true); } catch { try { player.stop(); } catch {} }
          try { player.removeAllListeners(); } catch {}
        } catch (e) {
          console.error('player.stop()失敗:', e);
        }
      }
    }

    // --- VoiceConnection の破棄 ---
    if (voiceConnections instanceof Map) {
      for (const conn of voiceConnections.values()) {
        try {
          conn.destroy();
        } catch (e) {
          console.error('conn.destroy()失敗:', e);
        }
      }
    }

    // --- Discordクライアント終了 ---
    if (client && client.destroy) {
      try {
        await client.destroy();
      } catch (e) {
        console.error('client.destroy()失敗:', e);
      }
    }

    // --- 残っているタイマーの全解除（重要） ---
    if (global.clearableTimers) {
      for (const t of global.clearableTimers) {
        clearInterval(t);
        clearTimeout(t);
      }
    }

    console.log('[SIGINT] 終了処理完了');
  } catch (err) {
    console.error('終了処理中にエラー:', err);
  } finally {
    process.exit(0);
  }
});

process.on('uncaughtException', err => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', err => {
  console.error('[Unhandled Rejection]', err);
});

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
const activeChannels = new Map();
let isPlaying = {};
let nameMappings = {};
let speakUserName = {}; //07.24
const lastSpeakerInfo = {};
//08.20
const vcTimeRecording = {}; // guildIdごとにtrue/false
const vcJoinTimes = {};     // guildIdごとにBOTのVC参加時刻

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
].map(cmd => cmd.toJSON());

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

function saveSettings() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serverConfigs, null, 2), 'utf8');
  } catch (err) {
    console.error('設定ファイルの保存に失敗しました:', err);
  }
}

// テキストのサニタイズ
async function sanitizeText(text, guild) {
  const userMentionRegex = /<@!?(\d+)>/g;

  // メンションを名前に置換
  text = text.replace(userMentionRegex, (match, userId) => {
    const member = guild.members.cache.get(userId);
    return member ? `指名、${member.displayName}、` : '誰か';
  });

  // 〜 → から
  text = text.replace(/[〜～~]/g, 'から');

  text = text
    .replace(/<a?:\w+:\d+>/g, '')                               // カスタム絵文字削除
    .replace(/白神/g, 'しらかみ')                               // 白神 → しらかみ
    .replace(/イキリ激きも音読星人/g, 'いきりげききもおんどくせいじん') // 固有名詞読み替え
    .replace(/https?:\/\/\S+|www\.\S+/g, 'ゆーあーるえる')       // URL
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n.]/gu, '');            // 記号類除去

  return text.trim();
}

async function safeJoinVoiceChannel(member, guild, interaction) { //10.09
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("VC接続がタイムアウトしました（おそらくアプリがバックグラウンドに行った）"));
    }, 8000); // 8秒でタイムアウト

    try {
      const connection = joinVoiceChannel({
        channelId: member.voice.channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      connection.once('ready', () => {
        clearTimeout(timeout);
        resolve(connection);
      });

      connection.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });

    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
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
  const ffmpegProc = spawn(ffmpegPath, [
    '-i', mp3Path,
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-af', 'atempo=1.35',
    'pipe:1'
  ]);

  ffmpegProc.stderr.on('data', (data) => {
    // console.log(`ffmpeg stderr: ${data}`); // ←デバッグ時だけ表示
  });

  ffmpegProc.on('error', (err) => {
    console.error(`ffmpeg スポーン失敗: ${err.message}`);
  });

  return ffmpegProc.stdout;
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

// 音声再生関数（Map 化に合わせて書き換え）
const queueLocks = {};

async function playNextInQueue(guildId) {
  // queueLocks はオブジェクトのまま（小さなキーセット）
  if (queueLocks[guildId]) return;
  queueLocks[guildId] = true;

  try {
    // while 条件を Map 用に修正
    while (
      audioQueue.has(guildId) &&
      audioQueue.get(guildId).length > 0 &&
      voiceConnections.has(guildId) &&
      voiceConnections.get(guildId).state.status !== 'destroyed'
    ) {
      const { text, file } = audioQueue.get(guildId).shift();

      try {
        // gTTSを非同期生成
        await speakText(text, 'ja', file);

        // ffmpegをパイプで変換
        const stream = convertToPCMStream(file);

        // Discordで再生
        const player = createAudioPlayer();
        audioPlayers.set(guildId, player); // Map に保存
        const resource = createAudioResource(stream, {
          inputType: StreamType.Raw,
          inlineVolume: true
        });
        try { resource.volume.setVolume(0.8); } catch {}
        player.play(resource);

        if (
          voiceConnections.has(guildId) &&
          voiceConnections.get(guildId).state.status !== 'destroyed'
        ) {
          try {
            voiceConnections.get(guildId).subscribe(player);
          } catch (e) {
            // subscribe が失敗した場合はファイルを削除してループ抜け
            fs.unlink(file, () => {});
            break;
          }
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
function correctNamePronunciation(name = '', guildId) {
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

    const textChannel = client.channels.cache.get(activeChannels.get(guildId));
    if (textChannel?.isTextBased()) {
      textChannel.send(`BOTは${durationString}ほどVCで労働させられていましたわ。疲れましたわ。`);
    }

    vcJoinTimes[guildId] = null;
  }

  // 再生中断
  if (audioPlayers.has(guildId)) {
    try {
      audioPlayers.get(guildId).stop(true); // trueで現在の再生も止める
    } catch (err) {
      console.warn(`プレイヤー停止エラー: ${err.message}`);
      console.warn(`自動再起動を実行します`);
      // process.exit は呼ばない（PM2 が管理する）
    }
  }

 // 残りの未処理ファイル削除
if (audioQueue.has(guildId)) {
  for (const item of audioQueue.get(guildId)) {
    fs.unlink(item.file, err => {
      if (!err) return;

      // ENOENT は正常（すでに削除されている）
      if (err.code === 'ENOENT') {
        console.debug(`既に削除済み: ${item.file}`);
        return;
      }

      // 本当に異常なときにログ
      console.error(`ファイル削除失敗: ${item.file}`, err);
    });
  }

  audioQueue.set(guildId, []);
}

isPlaying[guildId] = false;


  // VC切断
  if (voiceConnections.has(guildId) && voiceConnections.get(guildId).state.status !== 'destroyed') {
    try {
      voiceConnections.get(guildId).destroy();
    } catch (e) {
      console.error('destroy エラー:', e);
    }
    voiceConnections.delete(guildId);
  }

  // テキスト通知
  if (activeChannels.has(guildId)) {
    const textChannel = client.channels.cache.get(activeChannels.get(guildId));
    if (textChannel?.isTextBased() && reasonText !== '') {
      textChannel.send(reasonText);
    }
    activeChannels.delete(guildId);
  }
}

// Bot起動時
client.once(Events.ClientReady, c => {
  loadServerConfigs();
  console.log(`(${c.user.tag}) が起動しましたわ！`);
});

// Interaction / Slash handling
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

      if (voiceConnections.has(guildId)) {
        await interaction.editReply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
        return;
      }

      if (!userVC) {
        await interaction.editReply('先にお前がVC入ってから言いませんこと？もしかしてアホの御方でございますか？');
        return;
      }

      try {
        const conn = joinVoiceChannel({
          channelId: userVC.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
        });
        // Map に格納
        voiceConnections.set(guildId, conn);

        // stateChange の監視（元のロジックを維持）
        try {
          conn.on('stateChange', (oldState, newState) => {
            if (newState.status === 'disconnected' || newState.status === 'destroyed') {
              try {
                setTimeout(() => {
                  const userVC2 = guild.members.me?.voice?.channel;
                  if (userVC2) {
                    // 再接続処理：新しい接続を作り Map に保存
                    const newConn = joinVoiceChannel({
                      channelId: userVC2.id,
                      guildId: guild.id,
                      adapterCreator: guild.voiceAdapterCreator,
                    });
                    voiceConnections.set(guildId, newConn);
                    // console.log(`[Rejoin] 再接続成功`);
                  } else {
                    // console.log(`[Rejoin] ユーザーVCが見つからず再接続スキップ`);
                  }
                }, 3000);
              } catch (err) {
                console.error(`[Rejoin Error] ${err.message}`);
                setTimeout(() => leaveVC(guildId, ''), 2000);
              }
            }
          });
        } catch (e) {
          // on が使えない場合もあるが無視
        }

        activeChannels.set(guildId, interaction.channelId);
        await interaction.editReply('入ってあげましたわ。');
      } catch (err) {
        console.error('VC参加失敗:', err);
        await interaction.editReply('VCへの参加に失敗しましたわ。');
      }
      break;

    case 'ik-kill':
      await interaction.deferReply();

      if (voiceConnections.has(guildId) && voiceConnections.get(guildId)?.state?.status !== 'destroyed' && activeChannels.has(guildId)) {
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

    case 'ik-vctimerecording':
      await interaction.deferReply();
      const timermode = interaction.options.getString('mode');

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
        await interaction.editReply('modeは `on` または `off` を指定してくださいませ。');
      }
      break;

    case 'ik-absolutekill':
      await interaction.deferReply();
      if (userId !== '1289133629972418613') {
        await interaction.editReply('このコマンドは一般階級ユーザーには使えませんわｗｗ');
        return;
      }

      if (voiceConnections.has(guildId) && voiceConnections.get(guildId)?.state?.status !== 'destroyed' && activeChannels.has(guildId)) {
        await interaction.editReply('は？強制切断されましたわ。');
        leaveVC(guildId, '');
      } else {
        await interaction.editReply('今はどこにも繋がっていませんわ。');
      }
      break;

    case 'ik-stcheck':
      await interaction.deferReply();
      if (voiceConnections.has(guildId) && voiceConnections.get(guildId)?.state) {
        await interaction.editReply(`voiceConnections: ${voiceConnections.get(guildId).state.status}\nactiveChannel: ${activeChannels.get(guildId)}`);
      } else {
        await interaction.editReply('状態確認を拒否しますわ');
      }
      break;

    case 'ik-namespeak':
      await interaction.deferReply();

      if (speakUserName[guildId] === undefined) {
        speakUserName[guildId] = true;
        saveSettings();
      }
      {
        const mode = interaction.options.getString('mode');
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
      }
      break;

    case 'ik-addword':
      await interaction.deferReply();
      {
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
      }
      break;

    case 'ik-removeword':
      await interaction.deferReply();
      {
        const toRemove = interaction.options.getString('読み');
        if (nameMappings[guildId]?.[toRemove]) {
          delete nameMappings[guildId][toRemove];
          await interaction.editReply(`${toRemove} を木端微塵にしてやりましたわｗ感謝しなさいｗｗ`);
        } else {
          await interaction.editReply(`${toRemove} が登録されてないですわね。いい加減にしてくださいませ`);
        }
      }
      break;

    case 'ik-wordlist':
      await interaction.deferReply();
      {
        const mappings = nameMappings[guildId];
        if (!mappings || Object.keys(mappings).length === 0) {
          await interaction.editReply('誤読リストに登録されてる単語がないですわね。ふざけんな。');
        } else {
          const list = Object.entries(mappings)
            .map(([k, v]) => `${k} → ${v}`)
            .join('\n');
          await interaction.editReply(`単語リスト:\n${list}`);
        }
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

// メッセージ処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  const content = message.content;
  const guildId = message.guild.id;

  if (!speakUserName[guildId]) speakUserName[guildId] = false; // 07.24

  if (!nameMappings[guildId]) {
    nameMappings[guildId] = {};
    nameMappings[guildId]['白神'] = 'しらかみ';
    nameMappings[guildId]['激きも音読星人'] = 'げききもおんどくせいじん';
  }

  // /ik.kill の処理（メッセージ版）
  if (content === '/ik.kill') {
    const botVC = message.guild.members.me?.voice?.channelId;
    const userVC = message.member.voice?.channelId;

    if (voiceConnections.has(guildId) && voiceConnections.get(guildId).state.status !== 'destroyed' && activeChannels.has(guildId)) {
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
      if (voiceConnections.has(guildId) && voiceConnections.get(guildId).state.status !== 'destroyed' && activeChannels.has(guildId)) {
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
    if (voiceConnections.has(guildId)) {
      message.reply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
      return;
    }
    if (!message.member.voice.channel) {
      message.reply('先にお前がVC入ってから言いませんこと？もしかしてアホの御方でございますか？');
      return;
    }
    try {
      const conn = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      voiceConnections.set(guildId, conn);
      activeChannels.set(guildId, message.channel.id);
      message.reply('入ってあげましたわ。');
    } catch (err) {
      console.error('VC参加失敗 (メッセージ版):', err);
      message.reply('VCへの参加に失敗しましたわ。');
    }
    return;
  }

  if (content === '/ik.help') {
    message.reply('いやですわwざまぁww少しは自分でなんとかしたらどうですの？w');
    return;
  }

  if (content === '/ik.stcheck') {
    if (voiceConnections.has(guildId) && voiceConnections.get(guildId).state) {
      message.reply('voiceConnectionsの今の状態は ' + voiceConnections.get(guildId).state.status + ' ですわ');
      message.reply('activeChannelsの今の状態は ' + activeChannels.get(guildId) + ' ですわ');
    } else {
      message.reply('状態確認を拒否しますわ');
    }
    return;
  }

  if (content === '/ik.w') {
    message.reply('何わらってやがりますの？くたばってくださいませｗ');
    return;
  }

  // コマンド登録（/ik.commandset など）の部分は元のまま
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
  }

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

  // 通常メッセージ読み上げ（Map に合わせて参照を修正）
  if (
    voiceConnections.has(guildId) &&
    message.channel.id === activeChannels.get(guildId) &&
    !content.startsWith('/')
  ) {
    let text = await sanitizeText(content, message.guild);
    text = replaceDotWithTen(text);
    if (message.attachments.size > 0) {
      text += ` 、添付ファイル`;
    }
    text = correctNamePronunciation(text, guildId);
    text = shortenText(text);
    if (text.length === 0) return;

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

    text = correctNamePronunciation(text, guildId);
    text = shortenText(text);
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `message_${uniqueId}.mp3`);

    if (!audioQueue.has(guildId)) audioQueue.set(guildId, []);
    audioQueue.get(guildId).push({ text, file: filePath });
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

        const textChannel = client.channels.cache.get(activeChannels.get(guildId));
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

  if (!voiceConnections.has(guildId) || !activeChannels.has(guildId)) return;

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
    if (!audioQueue.has(guildId)) audioQueue.set(guildId, []);
    audioQueue.get(guildId).push({ text, file: filePath });
    playNextInQueue(guildId);
  }

  // BotがVC内にいて誰も居なくなったら切断する処理
  if (currentVC) {
    const nonBotMembers = currentVC.members.filter(member => !member.user.bot);
    if (nonBotMembers.size === 0) {
      if (voiceConnections.has(guildId) && voiceConnections.get(guildId).state.status !== 'destroyed' && activeChannels.has(guildId)) {
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

          const textChannel = client.channels.cache.get(activeChannels.get(guildId));
          if (textChannel && textChannel.isTextBased()) {
            textChannel.send(`BOTは${durationString}ほどVCにいましたわ。お疲れ様ですわ。`);
          }

          vcJoinTimes[guildId] = null; // リセット
        }
        try {
          voiceConnections.get(guildId).destroy();
        } catch (e) {
          console.error('destroy エラー:', e);
        }
        voiceConnections.delete(guildId);
        const textChannel = client.channels.cache.get(activeChannels.get(guildId));
        if (textChannel && textChannel.isTextBased()) {
          textChannel.send('誰もVCにいなくなったので消滅します');
        }
        activeChannels.delete(guildId);
      }
    }
  }
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

  // process.on('exit') での後片付け（念のため Map を使って停止）
  process.on('exit', () => {
    for (const player of audioPlayers.values()) {
      try { player.stop(); } catch {}
    }
    for (const conn of voiceConnections.values()) {
      try { conn.destroy(); } catch {}
    }
  });

  client.on("guildCreate", async guild => {
    console.log(`新しいサーバーに参加しました: ${guild.name} (${guild.id})`);

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    const CLIENT_ID = client.application.id;

    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guild.id),
        { body: ikCommands }
      );
      console.log(`サーバー「${guild.name}」にコマンドを自動登録しました`);
    } catch (err) {
      console.error("スラッシュコマンド自動登録エラー:", err);
    }
  });

  client.login(process.env.BOT_TOKEN).then(() => {
    console.log(" Discord bot ログイン成功");
  }).catch(err => {
    console.error("Discord bot ログイン失敗:", err);
    console.warn(`自動再起動を実行します`);
    // process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.warn(`自動再起動を実行します`);
  //process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.warn(`自動再起動を実行します`);
  //process.exit(1);
});

client.on('error', err => {
  console.error('[Client Error]', err);
  console.warn(`自動再起動を実行します`);
  //process.exit(1);
});

client.on('shardError', err => {
  console.error('[Shard Error]', err);
  console.warn(`自動再起動を実行します`);
  //process.exit(1);
});

client.on('disconnect', event => {
  console.error('[Disconnected]', event);
  console.warn(`自動再起動を実行します`);
  //process.exit(1);
});
