export enum Floor {
  IDLE = 'IDLE',
  YOU_SPEAKING = 'YOU_SPEAKING',
  THEM_SPEAKING = 'THEM_SPEAKING',
}

export interface VADOptions {
  sampleRate: number; // Hz
  frameMs: number; // ms
  thresholdRms: number; // 0..32767
  hangoverFrames: number; // frames to wait before switching
}

export class EnergyVAD {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private readonly threshold: number;
  private readonly hangoverFrames: number;

  private speakingStreak: number = 0;
  private silenceStreak: number = 0;

  constructor(opts: VADOptions) {
    this.sampleRate = opts.sampleRate;
    this.frameSamples = Math.max(1, Math.round((opts.frameMs / 1000) * this.sampleRate));
    this.threshold = opts.thresholdRms;
    this.hangoverFrames = Math.max(1, opts.hangoverFrames);
  }

  detect(pcm16: Int16Array): boolean {
    if (pcm16.length === 0) return false;
    // Compute RMS over the buffer
    let sumSq = 0;
    for (let i = 0; i < pcm16.length; i++) {
      const s = pcm16[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / pcm16.length);
    const speaking = rms >= this.threshold;

    if (speaking) {
      this.speakingStreak += 1;
      this.silenceStreak = 0;
    } else {
      this.silenceStreak += 1;
      this.speakingStreak = 0;
    }

    // Hysteresis: require a streak of frames to flip state
    return this.speakingStreak >= 2; // at least two frames above threshold to mark speech
  }

  shouldRelease(): boolean {
    return this.silenceStreak >= this.hangoverFrames;
  }
}
