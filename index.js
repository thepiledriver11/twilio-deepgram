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
  let callStartTime = Date.now();
  let chunkIndex = 0;

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
    const startTime = data.start || 0;
    if (transcript && transcript.length > 0) {
      chunkIndex++;
      const timestamp = new Date().toISOString();
      const durationSeconds = ((Date.now() - callStartTime) / 1000).toFixed(1);

      console.log(`📝 Transcript [${chunkIndex}]: ${transcript}`);

      try {
        await fetch('https://app.voiceer.io/api/1.1/wf/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            call_sid: callSid || 'unknown',
            chunk_index: chunkIndex,
            timestamp,
            duration: durationSeconds,
            start_offset: startTime
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
      callStartTime = Date.now();
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
