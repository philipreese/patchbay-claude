import { encodeWav } from './wav';

const MAX_SECONDS = 10 * 60; // 10 minute safety cap

function pickMimeType(): string | null {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Records the master output. Prefers an AudioWorklet capture path (produces a
 * WAV blob via encodeWav); falls back to MediaRecorder when AudioWorklet is
 * unavailable or fails to load.
 */
export class MasterRecorder {
  private ctx: AudioContext;
  private source: AudioNode;
  private _active = false;
  private _seconds = 0;
  private _mimeType = '';

  // Worklet path
  private workletNode: AudioWorkletNode | null = null;
  private sinkGain: GainNode | null = null;
  private chunksL: Float32Array[] = [];
  private chunksR: Float32Array[] = [];
  private startedAt = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private secondsTimer: ReturnType<typeof setInterval> | null = null;

  // MediaRecorder fallback
  private mediaRecorder: MediaRecorder | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private mediaChunks: BlobPart[] = [];
  private mediaStopResolve: ((blob: Blob) => void) | null = null;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.ctx = ctx;
    this.source = source;
  }

  get active(): boolean {
    return this._active;
  }

  get seconds(): number {
    return this._seconds;
  }

  get mimeType(): string {
    return this._mimeType;
  }

  async start(): Promise<void> {
    if (this._active) return;
    this.chunksL = [];
    this.chunksR = [];
    this._seconds = 0;

    const worklet = await this.tryStartWorklet();
    if (!worklet) {
      await this.startFallback();
    }
    this._active = true;
    this.capTimer = setTimeout(() => {
      // Auto-stop at the cap; fire-and-forget since callers poll `active`/`seconds`.
      this.stop().catch(() => {});
    }, MAX_SECONDS * 1000);
  }

  private async tryStartWorklet(): Promise<boolean> {
    try {
      if (!this.ctx.audioWorklet) return false;
      const url = new URL('./worklets/recorder-worklet.js', import.meta.url);
      await this.ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(this.ctx, 'recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data && data.type === 'chunk') {
          this.chunksL.push(data.left);
          this.chunksR.push(data.right);
        }
      };
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.source.connect(node);
      node.connect(sink);
      sink.connect(this.ctx.destination);
      this.workletNode = node;
      this.sinkGain = sink;
      this.startedAt = this.ctx.currentTime;
      this._mimeType = 'audio/wav';
      this.secondsTimer = setInterval(() => {
        this._seconds = this.ctx.currentTime - this.startedAt;
      }, 200);
      return true;
    } catch {
      this.teardownWorklet();
      return false;
    }
  }

  private async startFallback(): Promise<void> {
    const mimeType = pickMimeType();
    if (typeof MediaRecorder === 'undefined' || !mimeType) {
      throw new Error('Recording isn’t supported in this browser.');
    }
    const dest = this.ctx.createMediaStreamDestination();
    this.source.connect(dest);
    this.mediaDest = dest;
    this.mediaChunks = [];
    const rec = new MediaRecorder(dest.stream, { mimeType });
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) this.mediaChunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(this.mediaChunks, { type: mimeType });
      if (this.mediaStopResolve) {
        this.mediaStopResolve(blob);
        this.mediaStopResolve = null;
      }
    };
    this.mediaRecorder = rec;
    this._mimeType = mimeType;
    this.startedAt = this.ctx.currentTime;
    rec.start(250);
    this.secondsTimer = setInterval(() => {
      this._seconds = this.ctx.currentTime - this.startedAt;
    }, 200);
  }

  async stop(): Promise<Blob> {
    if (!this._active) return new Blob([], { type: 'audio/wav' });
    this._active = false;
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    if (this.secondsTimer) {
      clearInterval(this.secondsTimer);
      this.secondsTimer = null;
    }

    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
      } catch {
        /* ignore */
      }
      const sampleRate = this.ctx.sampleRate;
      const left = concat(this.chunksL);
      const right = concat(this.chunksR);
      this.teardownWorklet();
      const buf = encodeWav([left, right], sampleRate);
      return new Blob([buf], { type: 'audio/wav' });
    }

    if (this.mediaRecorder) {
      return new Promise<Blob>((resolve) => {
        this.mediaStopResolve = resolve;
        try {
          this.mediaRecorder!.stop();
        } catch {
          resolve(new Blob(this.mediaChunks, { type: this._mimeType || 'audio/webm' }));
        }
        this.teardownMedia();
      });
    }

    return new Blob([], { type: 'audio/wav' });
  }

  private teardownWorklet() {
    try {
      this.source.disconnect(this.workletNode as any);
    } catch {
      /* ignore */
    }
    try {
      this.workletNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.sinkGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.workletNode = null;
    this.sinkGain = null;
  }

  private teardownMedia() {
    try {
      this.source.disconnect(this.mediaDest as any);
    } catch {
      /* ignore */
    }
    this.mediaDest = null;
    this.mediaRecorder = null;
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
