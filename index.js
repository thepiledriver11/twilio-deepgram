require('dotenv').config();
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('💥 Unhandled Error:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Promise Rejection:', err);
});

const app = express();

// ✅ Health check for Railway
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

  let deepgramReady = false;
  const audioBuffer = [];

  dgWs.on('open', () => {
    console.log('🧠 Deepgram connected');
    deepgramReady = true;

    // Flush any buffered audio
    audioBuffer.forEach(audio => dgWs.send(audio));
  });

  dgWs.on('message', async (message) => {
    const data = JSON.parse(message);
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (transcript && transcript.length > 0) {
      console.log(`📝 Transcript: ${transcript}`);

      try {
        const fetch = (await import('node-fetch')).default;
        await fetch('https://app.voiceer.io/api/1.1/wf/transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript })
        });
      } catch (err) {
        console.error('❌ Failed to POST transcript to Bubble:', err);
      }
    }
  });

  twilioWs.on('message', (message) => {
    const msg = JSON.parse(message);
    if (msg.event === 'media') {
      const audio = Buffer.from(msg.media.payload, 'base64');
      if (deepgramReady) {
        dgWs.send(audio);
      } else {
        console.log('🕓 Buffering audio until Deepgram is ready...');
        audioBuffer.push(audio);
      }
    }
    if (msg.event === 'stop') {
      dgWs.close();
    }
  });

  twilioWs.on('close', () => {
    dgWs.close();
  });
});

server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});

// Keep alive
new Promise(() => {});
