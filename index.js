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

// サーバーごとの誤読される名前のマッピング
let nameMappings = {}; // key: guildId, value: nameMapping

// テキストのサニタイズ
function sanitizeText(text) {
  return text
    .replace(/<a?:\w+:\d+>/g, '') // カスタム絵文字除去
    .replace(/https?:\/\/\S+|www\.\S+/g, 'ゆーあーるえる') // URLを"ゆーあーるえる"に置換
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
  if (
    isPlaying[guildId] ||
    !audioQueue[guildId] ||
    audioQueue[guildId].length === 0 ||
    !voiceConnections[guildId] ||
    voiceConnections[guildId].state.status === 'destroyed'
  ) {
    return;
  }

  const { text, file } = audioQueue[guildId].shift();
  isPlaying[guildId] = true;

  try {
    await speakText(text, 'ja', file);

    const player = createAudioPlayer();
    const resource = createAudioResource(file);
    player.play(resource);

    if (voiceConnections[guildId] && voiceConnections[guildId].state.status !== 'destroyed') {
      voiceConnections[guildId].subscribe(player);
    } else {
      console.warn(` サーバー ${guildId} のVoiceConnectionがもうデストロイ！されています`);
      isPlaying[guildId] = false;
      return;
    }

    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, (err) => {
        if (err) console.error(`ファイル削除エラー: ${err}`);
      });
      isPlaying[guildId] = false;
      playNextInQueue(guildId); // 次へ
    });

    player.on('error', (error) => {
      console.error(`AudioPlayer エラー: ${error.message}`);
      isPlaying[guildId] = false;
      playNextInQueue(guildId); // スキップ
    });
  } catch (err) {
    console.error('読み上げエラー:', err);
    isPlaying[guildId] = false;
    playNextInQueue(guildId); // スキップ
  }
}

// 名前を変換する関数（部分一致も対応）
function correctNamePronunciation(name, guildId) {
  const nameMapping = nameMappings[guildId] || {};
  // 名前全体に対して、部分一致する誤読を修正
  for (const [incorrectName, correctReading] of Object.entries(nameMapping)) {
    // 部分一致した場合のみ変換
    if (name.includes(incorrectName)) {
      name = name.replace(incorrectName, correctReading);
    }
  }
  return name;
}

// Botの起動時
client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しましたわ！`);
});

// メッセージ処理
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const content = message.content;
  const guildId = message.guild.id;

  // 初期化：サーバーの誤読名マッピングを初期化
  if (!nameMappings[guildId]) {
    nameMappings[guildId] = {};
    // デフォルト：白神 → しらかみ
    nameMappings[guildId]['白神'] = 'しらかみ';
  }

  // 殺処分コマンド
  if (content === '/ik.kill') {
    if (voiceConnections[guildId]&& voiceConnections[guildId].state.status !== 'destroyed') {
      voiceConnections[guildId].destroy();
      voiceConnections[guildId] = null;
      activeChannels[guildId] = null;
      message.reply('は？何してくれやがりますの？');
    } else {
      message.reply('どこにも繋いでないですわねwざんねん！w');
    }
    return;
  }

  // VC凸コマンド
  if (content === '/ik.join') {
    if (voiceConnections[guildId]) {
      message.reply('もう入ってますわねｗ目ぇついてらっしゃいますの？ｗｗｗ');
      return;
    }

    if (!message.member.voice.channel) {
      message.reply('先にお前がVC入ってから言いませんこと？もしかしてアホの方でございますか？');
      return;
    }
    voiceConnections[guildId] = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });
    activeChannels[guildId] = message.channel.id;
    message.reply('入りましたわ。だる。');
    return;
  }

  // 命乞い
  if (content === '/ik.help') {
    message.reply('いやですわwざまぁww少しは自分でなんとかしたらどうですの？w');
    return;
  }
  //デバッグ用
 if (content === '/ik.stcheck') {
   if (voiceConnections[guildId] && voiceConnections[guildId].state) {
   message.reply('今の状態は '+voiceConnections[guildId].state.status+' ですわ');
  } else {
     message.reply('状態確認を拒否しますわ');
   }
    return;
  }
  // --無意味なおまけ--
  //しばく
  if (content === '/ik.w') {
    message.reply('何わろとんねんくたばってくださいませ');
    return;
  }

  if (content === '/ik.konamon') {
    message.reply('ちんちん交通整備魂');
    return;
  }

 

  // 名前追加コマンド /ik.addword 名前 正しい読み方
  if (content.startsWith('/ik.addword')) {
    const args = content.split(' ').slice(1);
    if (args.length === 2) {
      const [incorrectName, correctReading] = args;
      if (nameMappings[guildId][incorrectName]) {
        message.reply(`${incorrectName} はすでに登録されてますわボケ。`);
      } else {
        nameMappings[guildId][incorrectName] = correctReading;
        message.reply(`新しいの登録してやりました、ほんまだるいですわ: ${incorrectName} → ${correctReading}`);
      }
    } else {
      message.reply('正しいコマンドすら入力できないのですか？ｗ　お手本: /ik.addword 白神 しらかみ');
    }
    return;
  }

  // 名前削除コマンド /ik.removeword 名前
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

  // 誤読リスト表示コマンド /ik.wordlist
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

  // 通常メッセージ読み上げ
if (voiceConnections[guildId] && message.channel.id === activeChannels[guildId] && !content.startsWith('/')) {
  let text = sanitizeText(content);
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

// VCの出入りを読み上げ
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = newState.guild.id;
  if (!voiceConnections[guildId] || !activeChannels[guildId]) return;

  let text = null;

  // 誰かがVCに入った
  if (!oldState.channel && newState.channel) {
    const member = newState.member || newState.guild.members.cache.get(newState.id);
    const correctedName = correctNamePronunciation(member?.displayName, guildId);
    text = `${correctedName}が侵入しましたわね。`;

  // 誰かがVCから出た
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
