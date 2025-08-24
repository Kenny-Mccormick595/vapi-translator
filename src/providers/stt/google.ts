import { SpeechClient } from '@google-cloud/speech';

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
  private stream: any;
  private buffers: Int16Array[] = [];

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
    this.stream = this.client.streamingRecognize(this.request);
  }

  write(pcm: Int16Array) {
    this.stream.write({ audioContent: Buffer.from(pcm.buffer) });
  }

  async flush(): Promise<{ text: string; isFinal: boolean } | null> {
    // For streaming API, we resolve on the next 'data' event; here we set up a one-shot promise
    return new Promise((resolve) => {
      const onData = (data: any) => {
        try {
          const result = data.results?.[0];
          const alt = result?.alternatives?.[0];
          const text = (alt?.transcript || '').trim();
          this.stream.removeListener('data', onData);
          resolve(text ? { text, isFinal: !!result?.isFinal } : null);
        } catch {
          this.stream.removeListener('data', onData);
          resolve(null);
        }
      };
      this.stream.on('data', onData);
      // push a zero-length to force flush boundary
      this.stream.write({ audioContent: Buffer.alloc(0) });
    });
  }
}
