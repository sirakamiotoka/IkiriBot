require('dotenv').config(); 
const express = require('express');
const { Client, Events, GatewayIntentBits } = require('discord.js');
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

// テキストのサニタイズ
async function sanitizeText(text, guild) {
  const userMentionRegex = /<@!?(\d+)>/g;
  text = text.replace(userMentionRegex, (match, userId) => {
    const member = guild.members.cache.get(userId);
    return member ? `指名、${member.displayName}、` : '誰か';
  });

  return text
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'ゆーあーるえる')
    .replace(/[^\p{L}\p{N}\p{Zs}。、！？\n]/gu, '')
    .trim();
}

// テキスト短縮
function shortenText(text, limit = 70) {
  return text.length > limit ? text.slice(0, limit) + ' 以下省略。' : text;
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

// 音声再生関数
async function playNextInQueue(guildId) {
  if (
    isPlaying[guildId] ||
    !audioQueue[guildId] ||
    audioQueue[guildId].length === 0 ||
    !voiceConnections[guildId] ||
    voiceConnections[guildId].state.status === 'destroyed'
  ) {
    isPlaying[guildId] = false;
    //audioQueue[guildId] = [];
    return;
  }
  isPlaying[guildId] = true;
  const { text, file } = audioQueue[guildId].shift();

  try {
    await speakText(text, 'ja', file);

    const player = createAudioPlayer();
    const resource = createAudioResource(file);
    player.play(resource);

    if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed') {
      voiceConnections[guildId].subscribe(player);
    }

    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, (err) => {
        if (err) console.error(`ファイル削除エラー: ${err}`);
      });
      isPlaying[guildId] = false;
      playNextInQueue(guildId);
    });

    player.on('error', (error) => {
      console.error(`AudioPlayer エラー: ${error.message}`);
      isPlaying[guildId] = false;
      playNextInQueue(guildId);
    });
  } catch (err) {
    console.error('読み上げエラー:', err);
    isPlaying[guildId] = false;
    playNextInQueue(guildId);
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

  isPlaying[guildId] = false;
  audioQueue[guildId] = [];
}

// Bot起動時
client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しましたわ！`);
});

// メッセージ処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  const content = message.content;
  const guildId = message.guild.id;

  if (!nameMappings[guildId]) {
    nameMappings[guildId] = {};
    nameMappings[guildId]['白神'] = 'しらかみ';
  }

  if (content === '/ik.kill') {
    if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed' && activeChannels[guildId] !== null) {
      leaveVC(guildId, 'は？何してくれやがりますの？');
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
    message.reply('何わろとんねんくたばってくださいませ');
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

  //  通常メッセージ読み上げ
  if (
    voiceConnections[guildId] &&
    message.channel.id === activeChannels[guildId] &&
    !content.startsWith('/')
  ) {
    let text = await sanitizeText(content, message.guild); // ← 修正ポイント
    if (text.length === 0) return;

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

  if (text) {
    const uniqueId = uuidv4();
    const filePath = path.join(__dirname, `vc_notice_${uniqueId}.mp3`);
    if (!audioQueue[guildId]) audioQueue[guildId] = [];
    audioQueue[guildId].push({ text, file: filePath });
    playNextInQueue(guildId);
  }

const botMember = newState.guild.members.me;
const currentVC = botMember?.voice?.channel;
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
