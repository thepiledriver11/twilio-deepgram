require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

process.on('uncaughtException', (err) => {
  console.error('💥 Unhandled Error:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Promise Rejection:', err);
});

const app = express();

app.get("/", (req, res) => {
  res.send("Server is live");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DEEPGRAM_URL = `wss://api.deepgram.com/v1/listen?punctuate=true&language=en&encoding=mulaw&sample_rate=8000`;

wss.on('connection', (twilioWs) => {
  console.log('🔌 Twilio connected');

  const dgWs = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
  });

  const audioBuffer = [];
  let callSid = null;

  dgWs.on('open', () => {
    console.log('🧠 Deepgram connected');
    while (audioBuffer.length > 0) {
      dgWs.send(audioBuffer.shift());
    }
  });

  dgWs.on('error', (err) => {
    console.error('❌ Deepgram WebSocket error:', err.message || err);
  });

  dgWs.on('message', async (message) => {
    const data = JSON.parse(message);
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (transcript && transcript.length > 0) {
      console.log(`📝 Transcript: ${transcript}`);

      try {
        await fetch('https://app.voiceer.io/api/1.1/wf/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            call_sid: callSid || 'unknown'
          })
        });
      } catch (err) {
        console.error('❌ Failed to POST transcript to Bubble:', err.message || err);
      }
    }
  });

  twilioWs.on('message', (message) => {
    const msg = JSON.parse(message);

    if (msg.event === 'start' && msg.start) {
      callSid = msg.start.callSid;
      console.log('📞 CallSid:', callSid);
    }

    if (msg.event === 'media') {
      const audio = Buffer.from(msg.media.payload, 'base64');

      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(audio);
      } else {
        audioBuffer.push(audio);
        console.warn('⏳ Buffering audio until Deepgram is ready...');
      }
    }

    if (msg.event === 'stop') {
      dgWs.close();
    }
  });

  twilioWs.on('close', () => dgWs.close());
});

server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});

// Keeps the process alive
new Promise(() => {});
