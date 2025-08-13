const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { SpeechClient } = require('@google-cloud/speech');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Google Cloud Speech-to-Text client (streaming, Hebrew)
// Ensure env vars are set: GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
const googlePrivateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const speechClient = new SpeechClient({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: googlePrivateKey,
  },
});

// Utility: translate text with OpenAI (Hebrew → English)
async function translateToEnglish(text) {
  if (!text || !text.trim()) return '';
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'Translate from Hebrew to English. Respond only with the translation.' },
      { role: 'user', content: text },
    ],
  });
  return (completion.choices?.[0]?.message?.content || '').trim();
}

// Basic health and validation endpoints so external services (like Vapi) can verify the server URL
app.get('/', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).send('OK');
});

app.head('/', (_req, res) => {
  res.sendStatus(200);
});

app.options('/', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,HEAD,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// Generic webhook receiver; responds 200 to acknowledge receipt during validation
app.post('/', express.json({ limit: '2mb' }), (req, res) => {
  // Optionally log for debugging
  try {
    console.log('Inbound webhook received at / with headers:', req.headers);
    if (req.body) {
      console.log('Body:', JSON.stringify(req.body));
    }
  } catch (_) {
    // ignore logging errors
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).json({ received: true });
});

// Dedicated webhook path in case you want to set a specific URL in Vapi
app.get('/webhook', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).send('OK');
});

app.head('/webhook', (_req, res) => {
  res.sendStatus(200);
});

app.options('/webhook', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,HEAD,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.post('/webhook', (req, res) => {
  try {
    console.log('Inbound webhook received at /webhook with headers:', req.headers);
    if (req.body) {
      console.log('Body:', JSON.stringify(req.body));
    }
  } catch (_) {}
  res.set('Access-Control-Allow-Origin', '*');
  res.status(200).json({ received: true });
});

// JSON events endpoint for Vapi Server Messages (transcripts, call lifecycle, errors)
// Point Vapi "Server URL" here when you enable events: https://YOUR-RENDER-URL/events
app.post('/events', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const payload = req.body;
    const headerCallId = req.headers['x-call-id'] || 'n/a';

    const handleEvent = (raw) => {
      let evt = raw;
      if (evt && typeof evt === 'object' && 'message' in evt) {
        evt = evt.message;
      }
      if (typeof evt === 'string') {
        try {
          const parsed = JSON.parse(evt);
          evt = parsed;
        } catch (_) {
          console.log(`[${headerCallId}] message(text):`, evt.substring(0, 200));
          return;
        }
      }

      const type = evt?.type || evt?.event || evt?.name || 'unknown';
      const callId = evt?.callId || evt?.call?.id || raw?.callId || headerCallId || 'n/a';

      switch (type) {
        case 'transcript.delta':
        case 'transcript.final': {
          const text = (evt.text || evt.transcript || evt.message || '').trim();
          if (!text) return;
          console.log(`[${callId}] ${type}: ${text}`);
          break;
        }
        case 'speech-update': {
          const role = evt.role || 'unknown';
          const status = evt.status || 'n/a';
          console.log(`[${callId}] speech-update: role=${role} status=${status}`);
          break;
        }
        case 'status-update': {
          const status = evt.status || 'n/a';
          const endedReason = evt.endedReason || '';
          console.log(`[${callId}] status-update: ${status}${endedReason ? ` (${endedReason})` : ''}`);
          break;
        }
        case 'conversation-update': {
          const msgs = evt.messages || evt.messagesOpenAIFormatted || [];
          if (Array.isArray(msgs) && msgs.length) {
            const last = msgs[msgs.length - 1];
            const role = last.role || last.speaker || 'n/a';
            let text = '';
            if (typeof last.content === 'string') text = last.content;
            else if (Array.isArray(last.content)) {
              const part = last.content.find((c) => typeof c.text === 'string' || typeof c.content === 'string');
              text = (part?.text || part?.content || '').toString();
            } else if (last.text) text = last.text;
            text = (text || '').trim();
            const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
            console.log(`[${callId}] conversation-update: ${role}: ${snippet || '(no text)'}`);
          } else {
            console.log(`[${callId}] conversation-update: (no messages)`);
          }
          break;
        }
        case 'end-of-call-report': {
          const summary = (evt.summary || '').toString();
          const snippet = summary.length > 300 ? `${summary.slice(0, 300)}…` : summary;
          const cost = evt.cost || evt.costs || evt.costBreakdown || null;
          const durationSec = evt.durationSeconds || (typeof evt.durationMs === 'number' ? Math.round(evt.durationMs / 1000) : null);
          console.log(`[${callId}] end-of-call: duration=${durationSec ?? 'n/a'}s, summary=${snippet || '(none)'}${cost ? `, cost=${JSON.stringify(cost)}` : ''}`);
          break;
        }
        case 'call.started':
        case 'call.ended':
        case 'call.failed':
        case 'call.warning':
        case 'error': {
          const brief = JSON.stringify(evt).slice(0, 500);
          console.log(`[${callId}] ${type}:`, brief);
          break;
        }
        default: {
          const summary = { type, keys: Object.keys(evt || {}) };
          console.log(`[${callId}] event:`, summary);
        }
      }
    };

    if (Array.isArray(payload)) {
      payload.forEach(handleEvent);
    } else if (payload && typeof payload === 'object' && Array.isArray(payload.messages)) {
      payload.messages.forEach(handleEvent);
    } else {
      handleEvent(payload);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling /events payload:', error);
    res.status(200).json({ ok: true });
  }
});

app.post('/translate', express.json(), async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) {
    return res.status(400).json({ error: 'Transcript is required' });
  }
  try {
    const translated = await translateToEnglish(transcript);
    res.json({ text: translated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

//
// Vapi Realtime (WebSocket) entrypoint
//
// Configure in Vapi: Server URL → wss://YOUR-RENDER-URL/vapi
// Transcriber: Google (on Vapi side) OR send raw audio buffers here (PCM 16k) using input_audio_buffer events.
// Voice: Vapi Voice (English). Model: OpenAI gpt-4o-mini for translation (we call OpenAI here).
// Audio Routing (in Vapi): Mute my raw mic to caller; caller → me direct; assistant speaks translations to caller.
//
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/vapi' });

// Maintain per-connection STT stream and throttling state
function createGoogleStreamingRecognize() {
  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'he-IL',
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    },
    interimResults: true,
  };
  return speechClient.streamingRecognize(request);
}

// Simple throttle to avoid over-speaking on every tiny interim
function createThrottle(minMs) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= minMs) {
      last = now;
      return true;
    }
    return false;
  };
}

wss.on('connection', (ws) => {
  console.log('Vapi WS connected');

  const sttStream = createGoogleStreamingRecognize();
  const allowSpeak = createThrottle(700); // ~0.7s between interim speaks

  sttStream.on('error', (err) => {
    console.error('Google STT stream error:', err);
  });

  sttStream.on('data', async (data) => {
    try {
      const results = data.results || [];
      if (!results.length) return;
      const alt = results[0].alternatives?.[0];
      const transcript = (alt?.transcript || '').trim();
      if (!transcript) return;

      const isFinal = results[0].isFinal === true;
      if (!isFinal && !allowSpeak()) {
        return; // throttle interim updates
      }

      const translated = await translateToEnglish(transcript);
      if (!translated) return;

      // Tell Vapi to speak this text using its configured voice
      // Using a generic Realtime-compatible directive
      const message = {
        type: 'response.create',
        response: {
          instructions: translated,
        },
      };
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('STT data handling error:', error);
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Expecting input audio chunks from Vapi in PCM16 base64 via messages like:
      // { type: 'input_audio_buffer.append', audio: '<base64 pcm16 mono 16k>' }
      if (msg?.type === 'input_audio_buffer.append' && typeof msg.audio === 'string') {
        const audioBuffer = Buffer.from(msg.audio, 'base64');
        sttStream.write({ audioContent: audioBuffer });
        return;
      }
      // Optional: handle commit/end signals if Vapi sends them
      if (msg?.type === 'input_audio_buffer.commit') {
        return;
      }
      if (msg?.type === 'session.update') {
        // You can inspect session params here if needed
        return;
      }
      // Unknown messages are ignored
    } catch (error) {
      console.error('WS message parse error:', error);
    }
  });

  ws.on('close', () => {
    try { sttStream.end(); } catch (_) {}
    console.log('Vapi WS disconnected');
  });
});

// HTTP fallback: handle text transcripts (if Vapi posts transcript deltas to your Server URL)
// Configure Vapi to POST transcript chunks here if not using WS.
app.post('/vapi/webhook', express.json(), async (req, res) => {
  try {
    const event = req.body || {};
    // Example expected formats (adjust to your Vapi event schema):
    // { type: 'transcript.delta', text: '...' }
    // { type: 'transcript.final', text: '...' }
    const text = (event.text || '').trim();
    if (!text) {
      return res.status(200).json({ ok: true });
    }
    const translated = await translateToEnglish(text);
    if (!translated) {
      return res.status(200).json({ ok: true });
    }
    // Suggest a speak action back to Vapi (schema may vary by Vapi version)
    return res.status(200).json({
      actions: [
        { type: 'speak', text: translated },
      ],
    });
  } catch (error) {
    console.error('HTTP webhook error:', error);
    return res.status(200).json({ ok: true });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on port ${port}`));