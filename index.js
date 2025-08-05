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

// Discordクライアント作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// グローバル変数をサーバーごとに管理
let activeChannels = {};
let voiceConnections = {};
const audioQueue = {};
let isPlaying = {};
let nameMappings = {};
let speakUserName = {}; //07.24
const lastSpeakerInfo = {}; 
// const speechSpeed = {}; //07.29

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

  new SlashCommandBuilder()
    .setName('ik-addword')
    .setDescription('読み間違えてる部分を変えてあげます')
    .addStringOption(option =>
      option.setName('incorrect')
        .setDescription('Botが誤読してる読み方')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('correct')
        .setDescription('正しい読み方')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ik-removeword')
    .setDescription('誤読修正単語を木端微塵にします')
    .addStringOption(option =>
      option.setName('incorrect')
        .setDescription('削除する名前')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('ik-wordlist')
    .setDescription('登録されている誤読修正一覧を表示します'),

  new SlashCommandBuilder()
    .setName('ik-help')
    .setDescription('助けを乞います'),

].map(cmd => cmd.toJSON());

/*client.on(Events.InteractionCreate, async interaction => {
});*/


// テキストのサニタイズ
async function sanitizeText(text, guild) {
  const userMentionRegex = /<@!?(\d+)>/g;
  text = text.replace(userMentionRegex, (match, userId) => {
    const member = guild.members.cache.get(userId);
    return member ? `指名、${member.displayName}、` : '誰か';
  });

  text = text.replace(/[〜～]/g, 'から');
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
    '-af', 'atempo=1.3',
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
      .audioFilters('atempo=1.3') //07.29追加
      
      .save(pcmPath)
      .on('end', () => resolve(pcmPath))
      .on('error', (err) => {
        console.error('ffmpeg変換エラー:', err);
        reject(err);
      });
  });
}



// 音声再生関数
/*
08.04
async function playNextInQueue(guildId) {
  if (isPlaying[guildId]) return;
  isPlaying[guildId] = true;

  while (
    audioQueue[guildId] &&
    audioQueue[guildId].length > 0 &&
    voiceConnections[guildId] &&
    voiceConnections[guildId].state.status !== 'destroyed'
  ) {
    const { text, file } = audioQueue[guildId].shift();

    try {
      await speakText(text, 'ja', file);
      const pcmPath = file.replace('.mp3', '.pcm');
      await convertToPCM(file, pcmPath);

      const player = createAudioPlayer();
      const stream = fs.createReadStream(pcmPath);

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
        console.warn(`再生中断: VCが切断されていました (guildId: ${guildId})`);
        fs.unlink(file, () => {});
        fs.unlink(pcmPath, () => {});
        break; 
      }

      await new Promise((resolve) => {
        player.once(AudioPlayerStatus.Idle, () => {
          fs.unlink(file, () => {});
          fs.unlink(pcmPath, () => {});
          resolve();
        });

        player.once('error', (error) => {
          console.error(`AudioPlayer エラー: ${error.message}`);
          fs.unlink(file, () => {});
          fs.unlink(pcmPath, () => {});
          resolve();
        });
      });

    } catch (err) {
      console.error('再生中エラー:', err);
    }
  }

  isPlaying[guildId] = false;
}
*/

//08.04
async function playNextInQueue(guildId) {
  if (isPlaying[guildId]) return;
  isPlaying[guildId] = true;

  while (
    audioQueue[guildId] &&
    audioQueue[guildId].length > 0 &&
    voiceConnections[guildId] &&
    voiceConnections[guildId].state.status !== 'destroyed'
  ) {
    const { text, file } = audioQueue[guildId].shift();

    try {
      // ❶ gTTSを非同期生成
      await speakText(text, 'ja', file);

      // ❷ ffmpegをパイプで変換
      const stream = convertToPCMStream(file);

      // ❸ Discordで再生
      const player = createAudioPlayer();
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

  isPlaying[guildId] = false;
}
//08.04




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

function leaveVC(guildId, reasonText = '切断されましたわ。') {
  if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed') {
    voiceConnections[guildId].destroy();
    voiceConnections[guildId] = null;
  }

  if (activeChannels[guildId]) {
    const textChannel = client.channels.cache.get(activeChannels[guildId]);
    if (textChannel && textChannel.isTextBased()) {
      textChannel.send(reasonText);
    }
    activeChannels[guildId] = null;
  }

  // キューの音声ファイルを削除
  if (audioQueue[guildId]) {
    for (const item of audioQueue[guildId]) {
      fs.unlink(item.file, err => {
        if (err) console.error(`未処理ファイル削除失敗: ${err.message}`);
      });
    }
  }

  isPlaying[guildId] = false;
  audioQueue[guildId] = [];
}


// Bot起動時
client.once(Events.ClientReady, c => {
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
      if (voiceConnections[guildId]) {
        await interaction.reply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
        return;
      }
      if (!userVC) {
        await interaction.reply('先にお前がVC入ってから言いませんこと？もしかしてアホの御方でございますか？');
        return;
      }
      voiceConnections[guildId] = joinVoiceChannel({
        channelId: userVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      activeChannels[guildId] = interaction.channelId;
      await interaction.reply('入ってあげましたわ。');
      break;

    case 'ik-kill':
      if (voiceConnections[guildId]?.state.status !== 'destroyed' && activeChannels[guildId]) {
        if (botVC && userVC?.id === botVC) {
          leaveVC(guildId, 'は？何してくれやがりますの？');
          await interaction.reply('切断してやりましたわｗ');
        } else {
          await interaction.reply('同じVCにいない君には命令権限はありませんわｗｗ');
        }
      } else {
        await interaction.reply('どこにも繋いでないですわねwざんねん！w');
      }
      break;

    case 'ik-absolutekill':
      if (userId !== '1289133629972418613') {
        await interaction.reply('このコマンドは一般階級ユーザーには使えませんわｗｗ');
        return;
      }
      if (voiceConnections[guildId]?.state.status !== 'destroyed' && activeChannels[guildId]) {
        leaveVC(guildId, 'は？強制切断されましたわ。');
        await interaction.reply('強制で切ってやりましたわ。');
      } else {
        await interaction.reply('今はどこにも繋がっていませんわ。');
      }
      break;

    case 'ik-stcheck':
      if (voiceConnections[guildId]?.state) {
        await interaction.reply(`voiceConnections: ${voiceConnections[guildId].state.status}\nactiveChannel: ${activeChannels[guildId]}`);
      } else {
        await interaction.reply('状態確認を拒否しますわ');
      }
      break;

    case 'ik-namespeak':
      const mode = interaction.options.getString('mode');
      speakUserName[guildId] = (mode === 'on');
      await interaction.reply(mode === 'on'
        ? '名前も呼んであげますわ。光栄に思いなさいｗ'
        : 'もう名前は呼んであげませんわw');
      break;

    case 'ik-addword':
      const incorrect = interaction.options.getString('incorrect');
      const correct = interaction.options.getString('correct');
      if (!nameMappings[guildId]) nameMappings[guildId] = {};
      if (nameMappings[guildId][incorrect]) {
        await interaction.reply(`${incorrect} はすでに登録されてますわボケ。`);
      } else {
        nameMappings[guildId][incorrect] = correct;
        await interaction.reply(`新しいの登録してやりました、感謝してくださいまし: ${incorrect} → ${correct}`);
      }
      break;

    case 'ik-removeword':
      const toRemove = interaction.options.getString('incorrect');
      if (nameMappings[guildId]?.[toRemove]) {
        delete nameMappings[guildId][toRemove];
        await interaction.reply(`${toRemove} を木端微塵にしてやりましたわｗ感謝しなさいｗｗ`);
      } else {
        await interaction.reply(`${toRemove} が登録されてないですわね。いい加減にしてくださいませ`);
      }
      break;

    case 'ik-wordlist':
      const mappings = nameMappings[guildId];
      if (!mappings || Object.keys(mappings).length === 0) {
        await interaction.reply('誤読リストに登録されてる単語がないですわね。ふざけんな。');
      } else {
        const list = Object.entries(mappings)
          .map(([k, v]) => `${k} → ${v}`)
          .join('\n');
        await interaction.reply(`単語リスト:\n${list}`);
      }
      break;

    default:
      await interaction.reply('そのコマンドには対応しておりませんわ。');
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
    nameMappings[guildId]['～'] = 'から';
    nameMappings[guildId]['~'] = 'から';
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
  const guildId = newState.guild.id;
  const botId = client.user.id;

  if (oldState.id === botId && oldState.channelId && !newState.channelId) {
    leaveVC(guildId, '権限者の手によって木端微塵にされましたわ...');
    return;
  }

  if (!voiceConnections[guildId] || !activeChannels[guildId]) return;

  // 07.28移動
const botMember = newState.guild.members.me;
const currentVC = botMember?.voice?.channel;
  // 移動終了

// 07.28追加
  if (!currentVC) return;

　// 読み上げ対象をBotと同じVCに限定
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
  
  /*
  07.28コメントアウト
  let text = null;
  if (!oldState.channel && newState.channel) {
    const member = newState.member || newState.guild.members.cache.get(newState.id);
    const correctedName = correctNamePronunciation(member?.displayName, guildId);
    text = `${correctedName}が侵入しましたわね。`;
  } else if (oldState.channel && !newState.channel) {
    const member = oldState.member || oldState.guild.members.cache.get(oldState.id);
    const correctedName = correctNamePronunciation(member?.displayName, guildId);
    text = `${correctedName}がくたばりました。`;
  }
  */
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
    process.exit(1);
  }

  client.login(process.env.BOT_TOKEN).then(() => {
    console.log(" Discord bot ログイン成功");
  }).catch(err => {
    console.error("Discord bot ログイン失敗:", err);
    process.exit(1);
  });
});
