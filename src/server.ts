import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
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
app.use(express.static(path.join(process.cwd(), 'public')));
app.get('/test.html', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'test.html')));
app.get('/test', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8" /><title>Tester</title><style>body{font-family:system-ui,Arial;padding:16px}#log{white-space:pre-wrap;background:#111;color:#eee;padding:8px;height:200px;overflow:auto}</style></head><body><h3>Live Translator Tester</h3><label>Server WS URL:</label> <input id="wsurl" size="60" value="wss://${(process.env.RENDER_EXTERNAL_URL || 'YOUR-RENDER-URL').replace(/^https?:\/\//,'')}\/ws" /><br/><br/><button id="connect-you">Connect as YOU</button><button id="connect-them">Connect as THEM</button><button id="disconnect">Disconnect</button><br/><br/><div id="log"></div><script>const logEl=document.getElementById('log');const log=(...a)=>{logEl.textContent+=a.join(' ')+'\n';logEl.scrollTop=logEl.scrollHeight};let ws,audioCtx,scriptNode;async function startMic(leg){const sampleRate=16000;audioCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate});const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const source=audioCtx.createMediaStreamSource(stream);const processor=audioCtx.createScriptProcessor(4096,1,1);processor.onaudioprocess=e=>{if(!ws||ws.readyState!==WebSocket.OPEN)return;const input=e.inputBuffer.getChannelData(0);const pcm16=new Int16Array(input.length);for(let i=0;i<input.length;i++){let s=input[i];if(s>1)s=1;if(s<-1)s=-1;pcm16[i]=(s*32767)|0}ws.send(pcm16.buffer)};source.connect(processor);processor.connect(audioCtx.destination);scriptNode=processor}function playWav(buffer){const blob=new Blob([buffer],{type:'audio/wav'});const url=URL.createObjectURL(blob);new Audio(url).play()}function playPcm16(buffer,sampleRate=16000){const ctx=audioCtx||new (window.AudioContext||window.webkitAudioContext)({sampleRate});const int16=new Int16Array(buffer);const float32=new Float32Array(int16.length);for(let i=0;i<int16.length;i++){float32[i]=Math.max(-1,Math.min(1,int16[i]/32767))}const audioBuffer=ctx.createBuffer(1,float32.length,sampleRate);audioBuffer.getChannelData(0).set(float32);const src=ctx.createBufferSource();src.buffer=audioBuffer;src.connect(ctx.destination);src.start()}function connect(leg){const base=document.getElementById('wsurl').value.replace(/\/$/,'');ws=new WebSocket(base+'?leg='+leg);ws.binaryType='arraybuffer';ws.onopen=()=>{log('WS open as',leg);startMic(leg).catch(e=>log('mic err',e))};ws.onmessage=ev=>{if(typeof ev.data==='string'){log('TXT',ev.data.slice(0,120));return}const buf=ev.data;const u8=new Uint8Array(buf);if(u8[0]===123){let i=0;while(i<u8.length&&u8[i]!==10)i++;const header=new TextDecoder().decode(u8.slice(0,i));const payload=u8.slice(i+1).buffer;try{const meta=JSON.parse(header);if(meta.type==='tts'){playWav(payload);return}}catch(e){} }playPcm16(buf)};ws.onclose=e=>{log('WS closed', 'code=',e.code,'reason=',e.reason)};ws.onerror=e=>{log('WS error', e?.message||e)} }document.getElementById('connect-you').onclick=()=>connect('YOU');document.getElementById('connect-them').onclick=()=>connect('THEM');document.getElementById('disconnect').onclick=()=>{try{ws.close()}catch(e){} if(scriptNode)scriptNode.disconnect();if(audioCtx)audioCtx.close()};</script></body></html>`);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

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

function switchToYou() { session.floor = Floor.YOU_SPEAKING; console.log('[FLOOR] YOU'); }
function switchToThem() { session.floor = Floor.THEM_SPEAKING; console.log('[FLOOR] THEM'); }

async function handleYourPcm(pcm: Int16Array) {
  const speaking = session.vadYou.detect(pcm);
  if (speaking && session.floor !== Floor.YOU_SPEAKING) switchToYou();
  if (!speaking && session.vadYou.shouldRelease() && session.floor === Floor.YOU_SPEAKING) {
    const res = await session.stt.flush();
    console.log('[STT YOU]', res?.text || '(empty)');
    if (res?.text) {
      const translated = await session.translator.translate(res.text);
      console.log('[TRANS YOU]', translated || '(empty)');
      if (translated) {
        const wav = await session.tts.synthesize(translated);
        const themWs = session.them?.ws;
        if (themWs && themWs.readyState === themWs.OPEN) {
          const header = Buffer.from(JSON.stringify({ type: 'tts', sampleRate: SAMPLE_RATE }));
          const sep = Buffer.from('\n');
          themWs.send(Buffer.concat([header, sep, wav]));
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
    const youWs = session.you?.ws;
    if (youWs && youWs.readyState === youWs.OPEN) {
      const header = JSON.stringify({ type: 'passthrough', sampleRate: SAMPLE_RATE });
      youWs.send(header + '\n');
      youWs.send(Buffer.from(pcm.buffer));
    }
  }
}

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url?.split('?')[1] || '');
  const leg = (params.get('leg') || 'YOU').toUpperCase();
  const name = leg === 'THEM' ? 'THEM' : 'YOU';
  console.log('[WS] connected', name);
  const thisLeg: Leg = { ws, name: name as 'YOU' | 'THEM' };
  if (name === 'YOU') session.you = thisLeg; else session.them = thisLeg;

  ws.on('message', async (data) => {
    if (typeof data === 'string') return;
    const buf: Buffer = data as Buffer;
    const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    if (name === 'YOU') await handleYourPcm(pcm); else handleTheirPcm(pcm);
  });

  ws.on('close', () => {
    console.log('[WS] closed', name);
    if (session.you?.ws === ws) session.you = undefined;
    if (session.them?.ws === ws) session.them = undefined;
  });

  ws.on('error', (e) => {
    console.error('[WS] error', name, e);
  });
});

server.listen(PORT, () => console.log(`TS server listening on ${PORT}`));
