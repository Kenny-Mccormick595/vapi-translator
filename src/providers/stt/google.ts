import { SpeechClient } from '@google-cloud/speech';
import { Duplex } from 'stream';

export interface GoogleSTTConfig {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  languageCode: string; // 'he-IL'
  sampleRate: number; // 16000
}

export class GoogleStreamingSTT {
  private client: SpeechClient;
  private request: any;
  private stream?: Duplex;

  constructor(cfg: GoogleSTTConfig) {
    const credentials = (cfg.clientEmail && cfg.privateKey)
      ? { credentials: { client_email: cfg.clientEmail, private_key: (cfg.privateKey || '').replace(/\\n/g, '\n') }, projectId: cfg.projectId }
      : undefined;
    this.client = new SpeechClient(credentials as any);

    this.request = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: cfg.sampleRate,
        languageCode: cfg.languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_long'
      },
      interimResults: false,
    };
  }

  private ensureStream() {
    if (this.stream) return;
    const s = this.client.streamingRecognize(this.request);
    s.on('error', (err: any) => {
      // Swallow timeouts to avoid crashing; recreate on next write
      console.error('Google STT stream error:', err?.code || '', err?.details || err?.message || err);
      this.stream = undefined;
    });
    this.stream = s as unknown as Duplex;
  }

  write(pcm: Int16Array) {
    this.ensureStream();
    if (!this.stream) return;
    try {
      this.stream.write({ audioContent: Buffer.from(pcm.buffer) });
    } catch (e) {
      console.error('Google STT write error', e);
      this.stream = undefined;
    }
  }

  async flush(): Promise<{ text: string; isFinal: boolean } | null> {
    const s = this.stream;
    if (!s) return null;
    return new Promise((resolve) => {
      let done = false;
      const cleanup = () => {
        s.removeListener('data', onData);
        s.removeListener('error', onError);
        s.removeListener('end', onEnd);
      };
      const finish = (val: any) => { if (done) return; done = true; cleanup(); resolve(val); };

      const onData = (data: any) => {
        try {
          const result = data.results?.[0];
          const alt = result?.alternatives?.[0];
          const text = (alt?.transcript || '').trim();
          finish(text ? { text, isFinal: !!result?.isFinal } : null);
        } catch {
          finish(null);
        }
      };
      const onError = (_err: any) => finish(null);
      const onEnd = () => finish(null);

      s.once('data', onData);
      s.once('error', onError);
      s.once('end', onEnd);

      try { s.end(); } catch {}
      this.stream = undefined;

      // Hard timeout so we never hang if Google returns nothing
      setTimeout(() => finish(null), 4000).unref?.();
    });
  }
}
