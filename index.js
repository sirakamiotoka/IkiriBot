const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const gTTS = require('gtts');
const fs = require('fs');

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

client.once(Events.ClientReady, c => {
  console.log(`(${c.user.tag}) が起動しました！`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // 読み上げ機能（VC参加中 & アクティブチャンネル一致時のみ）
  if (voiceConnection && message.channel.id === activeChannel) {
    const text = `${message.content}`;
    const filepath = './message.mp3';
    const gtts = new gTTS(text, 'ja');

    gtts.save(filepath, function (err) {
      if (err) {
        console.error('音声生成エラー:', err);
        return;
      }

      const player = createAudioPlayer();
      const resource = createAudioResource(filepath);
      player.play(resource);
      voiceConnection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        fs.unlink(filepath, () => {});
      });
    });
    return;
  }

  // Botコマンド処理
  if (message.content === '/sy.kill') {
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
/*
  voiceConnection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapt

    activeChannel = message.channel.id;
    message.reply('ボイスチャンネルに接続したで。');
    return;
  }
*/
  if (message.content === '/sy.summon') {
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

  if (message.content === '/sy.help') {
    message.reply('教えませーんwざまぁwww');
  }
});

// オプション：VC入退室も読み上えるなら残してOK
client.on('voiceStateUpdate', (oldState, newState) => {
  if (!voiceConnection || !activeChannel) return;

  let text = null;

  if (!oldState.channel && newState.channel) {
    text = `${newState.member.displayName}が侵入しよった。`;
  } else if (oldState.channel && !newState.channel) {
    text = `${oldState.member.displayName}が消滅した。`;
  }

  if (text) {
    const gtts = new gTTS(text, 'ja');
    const filepath = './vc_notice.mp3';

    gtts.save(filepath, function (err) {
      if (err) return console.error('TTSエラー:', err);

      const player = createAudioPlayer();
      const resource = createAudioResource(filepath);
      player.play(resource);
      voiceConnection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        fs.unlink(filepath, () => {});
      });
    });
  }
});

client.login(process.env.BOT_TOKEN);

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(3000, () => {
  console.log(`Server is running at: https://ikiriBOT.up.railway.app:${3000}`);
});

