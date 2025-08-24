import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { EnergyVAD, Floor } from './audio/vad';
import { GoogleStreamingSTT } from './providers/stt/google';
import { OpenAITranslator } from './providers/translate/openai';
import { ElevenLabsTTS } from './providers/tts/elevenlabs';

dotenv.config();

// Env validation
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID || '';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || '';
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || '';
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

const SAMPLE_RATE = 16000; // Hz

const app = express();
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface Leg {
  ws: import('ws');
  name: 'YOU' | 'THEM';
}

interface Session {
  you?: Leg;
  them?: Leg;
  floor: Floor;
  vadYou: EnergyVAD;
  vadThem: EnergyVAD;
  stt: GoogleStreamingSTT;
  translator: OpenAITranslator;
  tts: ElevenLabsTTS;
  lastYouAudio: number;
  lastThemAudio: number;
}

function createSession(): Session {
  return {
    floor: Floor.IDLE,
    vadYou: new EnergyVAD({ sampleRate: SAMPLE_RATE, frameMs: 20, thresholdRms: 500, hangoverFrames: 8 }),
    vadThem: new EnergyVAD({ sampleRate: SAMPLE_RATE, frameMs: 20, thresholdRms: 500, hangoverFrames: 8 }),
    stt: new GoogleStreamingSTT({
      projectId: GOOGLE_PROJECT_ID,
      clientEmail: GOOGLE_CLIENT_EMAIL,
      privateKey: GOOGLE_PRIVATE_KEY,
      languageCode: 'he-IL',
      sampleRate: SAMPLE_RATE,
    }),
    translator: new OpenAITranslator({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, systemPrompt: 'Translate from Hebrew to English. Respond only with the translation.' }),
    tts: new ElevenLabsTTS({ apiKey: ELEVEN_API_KEY, voiceId: ELEVEN_VOICE_ID, sampleRate: SAMPLE_RATE }),
    lastYouAudio: Date.now(),
    lastThemAudio: Date.now(),
  };
}

const session: Session = createSession();

function switchToYou() { session.floor = Floor.YOU_SPEAKING; }
function switchToThem() { session.floor = Floor.THEM_SPEAKING; }

async function handleYourPcm(pcm: Int16Array) {
  const speaking = session.vadYou.detect(pcm);
  if (speaking && session.floor !== Floor.YOU_SPEAKING) switchToYou();
  if (!speaking && session.vadYou.shouldRelease() && session.floor === Floor.YOU_SPEAKING) {
    const res = await session.stt.flush();
    if (res?.text) {
      const translated = await session.translator.translate(res.text);
      if (translated) {
        const wav = await session.tts.synthesize(translated);
        if (session.them?.ws.readyState === session.them.ws.OPEN) {
          const header = Buffer.from(JSON.stringify({ type: 'tts', sampleRate: SAMPLE_RATE }));
          const sep = Buffer.from('\n');
          session.them.ws.send(Buffer.concat([header, sep, wav]));
        }
      }
    }
    session.floor = Floor.IDLE;
    return;
  }
  if (speaking) {
    session.stt.write(pcm);
  }
}

function handleTheirPcm(pcm: Int16Array) {
  const speaking = session.vadThem.detect(pcm);
  if (speaking && session.floor !== Floor.THEM_SPEAKING) switchToThem();
  if (!speaking && session.vadThem.shouldRelease() && session.floor === Floor.THEM_SPEAKING) session.floor = Floor.IDLE;
  if (speaking) {
    if (session.you?.ws.readyState === session.you.ws.OPEN) {
      const header = JSON.stringify({ type: 'passthrough', sampleRate: SAMPLE_RATE });
      session.you.ws.send(header + '\n');
      session.you.ws.send(Buffer.from(pcm.buffer));
    }
  }
}

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url?.split('?')[1] || '');
  const leg = (params.get('leg') || 'YOU').toUpperCase();
  const name = leg === 'THEM' ? 'THEM' : 'YOU';
  const thisLeg: Leg = { ws, name: name as 'YOU' | 'THEM' };
  if (name === 'YOU') session.you = thisLeg; else session.them = thisLeg;

  ws.on('message', async (data) => {
    if (typeof data === 'string') return;
    const pcm = new Int16Array(new Uint8Array(data as Buffer).buffer);
    if (name === 'YOU') await handleYourPcm(pcm); else handleTheirPcm(pcm);
  });

  ws.on('close', () => {
    if (session.you?.ws === ws) session.you = undefined;
    if (session.them?.ws === ws) session.them = undefined;
  });
});

server.listen(PORT, () => console.log(`TS server listening on ${PORT}`));
