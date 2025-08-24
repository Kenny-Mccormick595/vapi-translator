import axios from 'axios';
import { encodeWavMono16 } from '../../audio/utils';

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string; // default voice id
  sampleRate: number; // 16000
}

export class ElevenLabsTTS {
  private readonly cfg: ElevenLabsConfig;
  constructor(cfg: ElevenLabsConfig) { this.cfg = cfg; }

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.cfg.voiceId}/stream`;
    const resp = await axios.post(url, {
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      optimize_streaming_latency: 2
    }, {
      headers: {
        'xi-api-key': this.cfg.apiKey,
        'Accept': 'audio/wav',
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer'
    });
    return Buffer.from(resp.data);
  }
}
