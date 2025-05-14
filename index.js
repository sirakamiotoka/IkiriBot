const { Client, Events, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const https = require('https');

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

async function speakText(text, lang = 'ja', speed = 1.2, filepath = './message.mp3') {
  const url = googleTTS.getAudioUrl(text, {
    lang,
