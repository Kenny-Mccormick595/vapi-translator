const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const axios = require('axios');
const { SpeechClient } = require('@google-cloud/speech');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const VAPI_API_BASE = process.env.VAPI_API_BASE || '';

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

// Utility: POST to Vapi API with base fallbacks; returns axios response or throws last error
async function vapiPost(path, data, headers = {}) {
  const apiKey = process.env.VAPI_API_KEY;
  const commonHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...headers };
  const bases = [];
  if (VAPI_API_BASE) bases.push(VAPI_API_BASE.replace(/\/$/, ''));
  bases.push('https://api.vapi.ai/v1', 'https://api.vapi.ai');
  let lastErr;
  for (const base of bases) {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const resp = await require('axios').post(url, data, { headers: commonHeaders, timeout: 10000 });
      return resp;
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        lastErr = err;
        continue; // try next base on 404
      }
      throw err; // other errors bubble up immediately
    }
  }
  throw lastErr || new Error('All Vapi API base URLs failed');
}

// Try multiple common create-call endpoint paths
async function vapiCreateCall(payload) {
  // If fully specified URL is provided, use it directly
  const explicitUrl = process.env.VAPI_CREATE_CALL_URL && process.env.VAPI_CREATE_CALL_URL.trim();
  if (explicitUrl) {
    console.log(`Using explicit VAPI_CREATE_CALL_URL: ${explicitUrl}`);
    return vapiPost(explicitUrl, payload);
  }
  const candidates = [
    '/v1/calls',
    '/calls',
    '/v1/phone-calls',
    '/phone-calls',
    '/v1/calls/start',
    '/calls/start',
  ];
  let lastErr;
  for (const p of candidates) {
    try {
      const resp = await vapiPost(p, payload);
      console.log(`Create call succeeded via path: ${p}`);
      return resp;
    } catch (err) {
      if (err.response?.status === 404) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('No known create-call endpoint matched');
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

// Health check endpoint for Render UI setting "/healthz"
app.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
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

    // Per-call keypad buffer and idle-commit settings
    let keypadState = app.get('keypadState');
    if (!keypadState) {
      keypadState = new Map();
      app.set('keypadState', keypadState);
    }
    const DTMF_COMMIT_MS = Number(process.env.DTMF_COMMIT_MS || 0); // 0 disables idle commit
    const DEFAULT_COUNTRY_PREFIX = process.env.DEFAULT_COUNTRY_PREFIX || '';

    // Keep a per-call keypad buffer to collect digits until '#'
    // ensure reference stays the same
    keypadState = app.get('keypadState');

    async function startBridgedCall(targetE164) {
      const apiKey = process.env.VAPI_API_KEY;
      const assistantId = process.env.VAPI_ASSISTANT_ID;
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      const myNumber = process.env.MY_NUMBER;
      if (!apiKey || !assistantId || !phoneNumberId || !myNumber) {
        console.warn('Missing env VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID, or MY_NUMBER');
        return;
      }
      try {
        const resp = await vapiPost('/calls', {
          assistantId,
          phoneNumberId,
          customer: { number: myNumber },
          assistantOverrides: { forwardingPhoneNumber: targetE164 }
        });
        console.log(`Started bridged call to ${targetE164}:`, resp.data?.id || 'ok');
      } catch (err) {
        console.error('Failed to start bridged call:', err.response?.status, err.response?.data || err.message);
      }
    }

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

      // keypad record and idle-commit helper per call
      const rec = keypadState.get(callId) || { digits: '', timer: null };
      function scheduleCommit() {
        if (rec.timer) clearTimeout(rec.timer);
        if (!DTMF_COMMIT_MS || DTMF_COMMIT_MS < 500) return;
        rec.timer = setTimeout(() => {
          const rawDigits = rec.digits;
          keypadState.delete(callId);
          if (!rawDigits) return;
          let target = rawDigits;
          if (!target.startsWith('+') && DEFAULT_COUNTRY_PREFIX) {
            target = `${DEFAULT_COUNTRY_PREFIX}${target}`;
          }
          if (!/^\+\d{6,15}$/.test(target)) {
            console.warn(`[${callId}] keypad idle-commit not E.164 (+country...): ${target}`);
            return;
          }
          startBridgedCall(target);
        }, DTMF_COMMIT_MS);
      }

      const tryDigits = () => {
        let digits = '';
        if (typeof evt.digits === 'string') digits = evt.digits;
        else if (typeof evt.keypad === 'string') digits = evt.keypad;
        else if (evt.artifact && typeof evt.artifact === 'object') {
          const cand = evt.artifact.digits || evt.artifact.keypad || '';
          if (typeof cand === 'string') digits = cand;
        }
        if (!digits && typeof evt.message === 'string' && /^[0-9#*]+$/.test(evt.message)) digits = evt.message;
        if (!digits) return;

        rec.digits = (rec.digits + digits).slice(0, 64);
        keypadState.set(callId, rec);
        console.log(`[${callId}] keypad: ${rec.digits}`);

        // Commit when '#' is present
        if (rec.digits.includes('#')) {
          const rawTarget = rec.digits.split('#')[0];
          keypadState.delete(callId);
          let target = rawTarget;
          if (!target.startsWith('+') && DEFAULT_COUNTRY_PREFIX) {
            target = `${DEFAULT_COUNTRY_PREFIX}${target}`;
          }
          if (!/^\+\d{6,15}$/.test(target)) {
            console.warn(`[${callId}] keypad target not E.164 (+country...): ${target}`);
            return;
          }
          startBridgedCall(target);
          return;
        }

        // If no '#', use idle commit if configured
        if (DTMF_COMMIT_MS >= 500) scheduleCommit();
      };

      switch (type) {
        case 'transcript.delta':
        case 'transcript.final': {
          const text = (evt.text || evt.transcript || evt.message || '').trim();
          if (!text) return;
          console.log(`[${callId}] ${type}: ${text}`);
          break;
        }
        case 'keypad.input':
        case 'dtmf.input':
        case 'digits.input': {
          tryDigits();
          break;
        }
        case 'speech-update': {
          const role = evt.role || 'unknown';
          const status = evt.status || 'n/a';
          let snippet = '';
          const a = evt.artifact || {};
          if (typeof a === 'string') {
            snippet = a.slice(0, 200);
          } else if (a) {
            const cand = a.text || a.message || a.transcript || a.delta || a.caption || '';
            if (typeof cand === 'string') snippet = cand.slice(0, 200);
            else if (cand && typeof cand === 'object') {
              const s = cand.text || cand.content || '';
              if (typeof s === 'string') snippet = s.slice(0, 200);
            }
          }
          console.log(`[${callId}] speech-update: role=${role} status=${status}${snippet ? ` | ${snippet}` : ''}`);
          if (role === 'user') tryDigits();
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

// Manual bridge trigger: POST /bridge { number: "+E164" }
// Use this if your Vapi UI doesn't emit keypad events to /events
app.post('/bridge', express.json(), async (req, res) => {
  try {
    const apiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const myNumber = process.env.MY_NUMBER;
    const DEFAULT_COUNTRY_PREFIX = process.env.DEFAULT_COUNTRY_PREFIX || '';
    if (!apiKey || !assistantId || !phoneNumberId || !myNumber) {
      return res.status(400).json({ error: 'Missing env VAPI_API_KEY/VAPI_ASSISTANT_ID/VAPI_PHONE_NUMBER_ID/MY_NUMBER' });
    }

    let target = (req.body?.number || '').toString().trim();
    if (!target) return res.status(400).json({ error: 'number is required' });
    if (!target.startsWith('+') && DEFAULT_COUNTRY_PREFIX) {
      target = `${DEFAULT_COUNTRY_PREFIX}${target}`;
    }
    if (!/^\+\d{6,15}$/.test(target)) {
      return res.status(400).json({ error: 'number must be E.164 (+country...digits)' });
    }

    const resp = await vapiCreateCall({
      assistantId,
      phoneNumberId,
      customer: { number: myNumber },
      assistantOverrides: { forwardingPhoneNumber: target },
    });

    return res.status(200).json({ ok: true, callId: resp.data?.id || null, target });
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    console.error('POST /bridge failed:', status, data);
    return res.status(200).json({ ok: false, status, error: data });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on port ${port}`));