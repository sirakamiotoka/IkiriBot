
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ] 
});

const ttsClient = new textToSpeech.TextToSpeechClient();

client.once(Events.ClientReady, c => {
  console.log(`Ready! (${c.user.tag})`);
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.member.voice.channel) return;

  try {
    const text = message.content;
    
    // Google Cloud TTSでの音声合成
    const request = {
      input: { text: text },
      voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
      audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    await fs.writeFile('output.mp3', response.audioContent, 'binary');

    // ボイスチャンネルに接続して音声を再生
    const connection = joinVoiceChannel({
      channelId: message.member.voice.channel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createAudioResource('output.mp3');
    
    connection.subscribe(player);
    player.play(resource);
    
  } catch (error) {
    console.error('Error:', error);
    message.channel.send('音声の生成中にエラーが発生しました。');
  }
});

require('http').createServer((req, res) => res.end('')).listen(3000);

client.login(process.env.BOT_TOKEN);
