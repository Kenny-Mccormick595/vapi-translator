import axios from 'axios';

export interface STTChunkResult {
  text: string;
  isFinal: boolean;
}

export interface DeepgramSTTConfig {
  apiKey: string;
  language: string; // e.g., 'he'
  sampleRate: number; // 16000
}

// Minimal placeholder that batches PCM and sends to Deepgram endpoint.
// For production, replace with proper websocket streaming.
export class DeepgramSTT {
  private readonly cfg: DeepgramSTTConfig;
  private buffer: Int16Array[] = [];

  constructor(cfg: DeepgramSTTConfig) {
    this.cfg = cfg;
  }

  write(pcm: Int16Array) {
    this.buffer.push(pcm);
  }

  async flush(): Promise<STTChunkResult | null> {
    if (this.buffer.length === 0) return null;
    const mergedLen = this.buffer.reduce((a, b) => a + b.length, 0);
    const merged = new Int16Array(mergedLen);
    let o = 0;
    for (const c of this.buffer) { merged.set(c, o); o += c.length; }
    this.buffer = [];

    const resp = await axios.post(
      'https://api.deepgram.com/v1/listen?model=nova-2&language=' + encodeURIComponent(this.cfg.language),
      merged,
      {
        headers: {
          'Authorization': `Token ${this.cfg.apiKey}`,
          'Content-Type': 'application/octet-stream',
          'Accept': 'application/json',
        },
      }
    );
    const transcript = resp.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return { text: transcript, isFinal: true };
  }
}
