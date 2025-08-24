export function floatToPcm16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i];
    if (s < -1) s = -1;
    if (s > 1) s = 1;
    out[i] = (s * 32767) | 0;
  }
  return out;
}

export function concatPcm16(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function encodeWavMono16(pcm: Int16Array, sampleRate: number): Buffer {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const buffer = Buffer.alloc(44 + pcm.length * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + pcm.length * 2, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(1, 22);  // channels
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample

  buffer.write('data', 36);
  buffer.writeUInt32LE(pcm.length * 2, 40);

  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }
  return buffer;
}
