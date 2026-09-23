// Per-module audio implementations. Each runtime owns stable input/output
// nodes (so cables survive param changes) and runs `voices` copies of its
// signal path when fed by a polyphonic source.

import type { GateEvent, ModuleType, ParamValue, PatchModule, SeqData, SeqStep } from '../core/types';
import { SCALES } from '../core/moduleDefs';

export interface RuntimeHost {
  ctx: AudioContext;
  emitGate(moduleId: string, port: string, ev: GateEvent): void;
  tempo(): number;
  noise(color: string): AudioBuffer;
  /** Sequencer wrote new step data (wander). */
  mutateSeq(moduleId: string, data: SeqData): void;
}

export interface Runtime {
  readonly id: string;
  readonly type: ModuleType;
  readonly voices: number;
  output(port: string, voice: number): AudioNode | null;
  outputVoices(port: string): number;
  input(port: string, voice: number): AudioNode | null;
  gate?(port: string, ev: GateEvent): void;
  setParam(key: string, value: ParamValue): void;
  setData?(data: SeqData): void;
  dispose(): void;
}

const SMOOTH = 0.015;

function setSmooth(ctx: AudioContext, p: AudioParam, v: number, tc = SMOOTH) {
  const now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setTargetAtTime(v, now, tc);
}

function num(v: ParamValue | undefined, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function safeDisconnect(n: AudioNode | null | undefined) {
  try {
    n?.disconnect();
  } catch {
    /* already disconnected */
  }
}

function stopSource(n: AudioScheduledSourceNode) {
  try {
    n.stop();
  } catch {
    /* not started */
  }
  safeDisconnect(n);
}

abstract class Base implements Runtime {
  readonly id: string;
  readonly type: ModuleType;
  readonly voices: number;
  protected ctx: AudioContext;
  protected host: RuntimeHost;
  protected params: Record<string, ParamValue>;
  protected nodes: AudioNode[] = [];

  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    this.host = host;
    this.ctx = host.ctx;
    this.id = m.id;
    this.type = m.type;
    this.voices = voices;
    this.params = { ...m.params };
  }
  abstract output(port: string, voice: number): AudioNode | null;
  outputVoices(_port: string): number {
    return this.voices;
  }
  input(_port: string, _voice: number): AudioNode | null {
    return null;
  }
  setParam(key: string, value: ParamValue) {
    this.params[key] = value;
    this.apply(key);
  }
  protected abstract apply(key: string): void;
  protected track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  protected gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.track(g);
  }
  protected constant(v = 0): ConstantSourceNode {
    const c = this.ctx.createConstantSource();
    c.offset.value = v;
    c.start();
    return this.track(c);
  }
  dispose() {
    for (const n of this.nodes) {
      if (n instanceof AudioScheduledSourceNode) stopSource(n);
      else safeDisconnect(n);
    }
    this.nodes = [];
  }
}

// ---------------------------------------------------------------- Oscillator

class OscVoice {
  pitchIn: GainNode;
  fmIn: GainNode;
  out: GainNode;
  oscs: OscillatorNode[] = [];
  constructor(rt: OscRuntime) {
    const ctx = rt.ctxRef;
    this.pitchIn = ctx.createGain();
    this.pitchIn.gain.value = 1200; // 1.0 CV = one octave, in cents
    this.fmIn = ctx.createGain();
    this.out = ctx.createGain();
  }
}

class OscRuntime extends Base {
  private v: OscVoice[] = [];
  get ctxRef() {
    return this.ctx;
  }
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    for (let i = 0; i < voices; i++) {
      const voice = new OscVoice(this);
      this.nodes.push(voice.pitchIn, voice.fmIn, voice.out);
      this.v.push(voice);
    }
    this.rebuildOscs();
    this.apply('fm');
  }
  private baseFreq() {
    return 440 * Math.pow(2, num(this.params.octave) + num(this.params.tune) / 12);
  }
  private detunes(n: number): number[] {
    const fine = num(this.params.fine);
    const spread = num(this.params.spread, 12);
    if (n === 1) return [fine];
    return Array.from({ length: n }, (_, i) => fine + spread * ((i / (n - 1)) * 2 - 1));
  }
  private rebuildOscs() {
    const n = Math.max(1, Math.min(4, Math.round(num(this.params.unison, 1))));
    const t = this.ctx.currentTime;
    for (const voice of this.v) {
      for (const o of voice.oscs) {
        o.stop(t + 0.02);
        setTimeout(() => safeDisconnect(o), 80);
      }
      voice.oscs = [];
      const det = this.detunes(n);
      voice.out.gain.setTargetAtTime(1 / Math.sqrt(n), t, 0.01);
      for (let i = 0; i < n; i++) {
        const o = this.ctx.createOscillator();
        o.type = this.params.wave as OscillatorType;
        o.frequency.value = this.baseFreq();
        o.detune.value = det[i];
        voice.pitchIn.connect(o.detune);
        voice.fmIn.connect(o.frequency);
        o.connect(voice.out);
        // Stagger starts so unison copies don't begin phase-locked.
        o.start(t + Math.random() * 0.004);
        voice.oscs.push(o);
      }
    }
  }
  output(port: string, voice: number) {
    return port === 'out' ? this.v[voice]?.out ?? null : null;
  }
  input(port: string, voice: number) {
    const v = this.v[voice];
    if (!v) return null;
    return port === 'pitch' ? v.pitchIn : port === 'fm' ? v.fmIn : null;
  }
  protected apply(key: string) {
    switch (key) {
      case 'wave':
        for (const v of this.v) for (const o of v.oscs) o.type = this.params.wave as OscillatorType;
        break;
      case 'octave':
      case 'tune':
        for (const v of this.v) for (const o of v.oscs) setSmooth(this.ctx, o.frequency, this.baseFreq(), 0.01);
        break;
      case 'fine':
      case 'spread':
        for (const v of this.v) {
          const det = this.detunes(v.oscs.length);
          v.oscs.forEach((o, i) => setSmooth(this.ctx, o.detune, det[i]));
        }
        break;
      case 'unison':
        this.rebuildOscs();
        break;
      case 'fm': {
        const a = num(this.params.fm);
        for (const v of this.v) setSmooth(this.ctx, v.fmIn.gain, a * a * 1500);
        break;
      }
    }
  }
  dispose() {
    for (const v of this.v) for (const o of v.oscs) stopSource(o);
    super.dispose();
  }
}

// ---------------------------------------------------------------- Noise

export function makeNoiseBuffers(ctx: AudioContext): Record<string, AudioBuffer> {
  const len = Math.floor(ctx.sampleRate * 4);
  const mk = (fill: (d: Float32Array) => void) => {
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    fill(b.getChannelData(0));
    return b;
  };
  const white = mk((d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
  const pink = mk((d) => {
    // Paul Kellet's refined pink noise filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  });
  const brown = mk((d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  });
  return { white, pink, brown };
}

class NoiseRuntime extends Base {
  private out: GainNode;
  private src: AudioBufferSourceNode | null = null;
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.out = this.gain(0.8);
    this.apply('color');
  }
  output(port: string) {
    return port === 'out' ? this.out : null;
  }
  outputVoices() {
    return 1;
  }
  protected apply(key: string) {
    if (key !== 'color') return;
    const old = this.src;
    const s = this.ctx.createBufferSource();
    s.buffer = this.host.noise(String(this.params.color));
    s.loop = true;
    s.connect(this.out);
    s.start(this.ctx.currentTime, Math.random() * 3);
    this.src = s;
    if (old) stopSource(old);
  }
  dispose() {
    if (this.src) stopSource(this.src);
    super.dispose();
  }
}

// ---------------------------------------------------------------- Filter

function driveCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 3) / Math.tanh(3);
  }
  return c;
}
let DRIVE_CURVE: Float32Array<ArrayBuffer> | null = null;

class FilterVoice {
  in: GainNode;
  dry: GainNode;
  pre: GainNode;
  shaper: WaveShaperNode;
  wet: GainNode;
  biquad: BiquadFilterNode;
  post: GainNode;
  cutoffIn: GainNode;
  trackIn: GainNode;
  constructor(ctx: AudioContext) {
    this.in = ctx.createGain();
    this.dry = ctx.createGain();
    this.pre = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = DRIVE_CURVE ??= driveCurve();
    this.shaper.oversample = '2x';
    this.wet = ctx.createGain();
    this.biquad = ctx.createBiquadFilter();
    this.post = ctx.createGain();
    this.cutoffIn = ctx.createGain();
    this.cutoffIn.gain.value = 4800; // 1.0 CV = +4 octaves
    this.trackIn = ctx.createGain();
    this.trackIn.gain.value = 1200; // 1.0 CV = +1 octave (1:1 key tracking)
    this.in.connect(this.dry).connect(this.biquad);
    this.in.connect(this.pre).connect(this.shaper).connect(this.wet).connect(this.biquad);
    this.biquad.connect(this.post);
    this.cutoffIn.connect(this.biquad.detune);
    this.trackIn.connect(this.biquad.detune);
  }
  all(): AudioNode[] {
    return [this.in, this.dry, this.pre, this.shaper, this.wet, this.biquad, this.post, this.cutoffIn, this.trackIn];
  }
}

class FilterRuntime extends Base {
  private v: FilterVoice[] = [];
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    for (let i = 0; i < voices; i++) {
      const fv = new FilterVoice(this.ctx);
      this.nodes.push(...fv.all());
      this.v.push(fv);
    }
    for (const k of ['mode', 'cutoff', 'res', 'drive']) this.apply(k, true);
  }
  output(port: string, voice: number) {
    return port === 'out' ? this.v[voice]?.post ?? null : null;
  }
  input(port: string, voice: number) {
    const v = this.v[voice];
    if (!v) return null;
    return port === 'in' ? v.in : port === 'cutoff' ? v.cutoffIn : port === 'track' ? v.trackIn : null;
  }
  private makeup(): number {
    const mode = this.params.mode;
    const q = num(this.params.res, 1);
    // Tame the resonant peak's loudness in LP/HP modes.
    return mode === 'lowpass' || mode === 'highpass' ? 1 / (1 + Math.max(0, q - 2) / 7) : mode === 'bandpass' ? Math.min(3, 0.6 + q * 0.25) : 1;
  }
  protected apply(key: string, init = false) {
    const t = (p: AudioParam, v: number) => (init ? (p.value = v) : setSmooth(this.ctx, p, v));
    for (const v of this.v) {
      switch (key) {
        case 'mode':
          v.biquad.type = this.params.mode as BiquadFilterType;
          t(v.post.gain, this.makeup());
          break;
        case 'cutoff':
          t(v.biquad.frequency, num(this.params.cutoff, 1000));
          break;
        case 'res':
          t(v.biquad.Q, num(this.params.res, 1));
          t(v.post.gain, this.makeup());
          break;
        case 'drive': {
          const d = num(this.params.drive);
          t(v.dry.gain, 1 - d);
          t(v.pre.gain, 1 + d * 5);
          t(v.wet.gain, d * (1 / (1 + d * 1.5)));
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- Envelope

class EnvRuntime extends Base {
  private src: ConstantSourceNode[] = [];
  private outs: GainNode[] = [];
  private active: boolean[] = [];
  private lastOn: number[] = [];
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    for (let i = 0; i < voices; i++) {
      const s = this.constant(0);
      const o = this.gain(num(this.params.amount, 1));
      s.connect(o);
      this.src.push(s);
      this.outs.push(o);
      this.active.push(false);
      this.lastOn.push(0);
    }
  }
  output(port: string, voice: number) {
    return port === 'out' ? this.outs[voice] ?? null : null;
  }
  protected apply(key: string) {
    if (key === 'amount') for (const o of this.outs) setSmooth(this.ctx, o.gain, num(this.params.amount, 1));
  }
  gate(_port: string, ev: GateEvent) {
    const vi = ev.voice % this.voices;
    const p = this.src[vi].offset;
    const t = Math.max(ev.time, this.ctx.currentTime);
    const a = num(this.params.attack, 0.01);
    const d = num(this.params.decay, 0.3);
    const s = num(this.params.sustain, 0.6);
    const r = num(this.params.release, 0.4);
    if (ev.type === 'on') {
      if (ev.legato && this.active[vi]) return; // legato: keep the envelope flowing
      const velSens = num(this.params.velocity, 0.5);
      const peak = 1 - velSens * (1 - Math.max(0, Math.min(1, ev.velocity)));
      p.cancelScheduledValues(t);
      // Aim past the peak so the curve crosses it at exactly `a` seconds (analog-style attack).
      const over = 1.3;
      const tau = a / Math.log(over / (over - 1));
      p.setTargetAtTime(peak * over, t, Math.max(tau, 0.0003));
      p.setTargetAtTime(peak * s, t + a, Math.max(d / 4, 0.001));
      this.active[vi] = true;
      this.lastOn[vi] = t;
    } else {
      p.cancelScheduledValues(t);
      // If released during the attack, the attack event is cancelled only if it's
      // scheduled after t; otherwise the release takes over from the current value.
      p.setTargetAtTime(0, t, Math.max(r / 4, 0.001));
      this.active[vi] = false;
    }
  }
  /** Immediately silence (panic). */
  kill() {
    const t = this.ctx.currentTime;
    for (const s of this.src) {
      s.offset.cancelScheduledValues(t);
      s.offset.setTargetAtTime(0, t, 0.005);
    }
    this.active.fill(false);
  }
}

// ---------------------------------------------------------------- LFO

class LfoRuntime extends Base {
  private osc: OscillatorNode | null = null;
  private rnd: ConstantSourceNode;
  private depth: GainNode;
  private offset: ConstantSourceNode;
  private out: GainNode;
  private nextRnd = 0;
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.depth = this.gain(0);
    this.out = this.gain(1);
    this.offset = this.constant(0);
    this.rnd = this.constant(0);
    this.depth.connect(this.out);
    this.offset.connect(this.out);
    this.applyWave();
    this.apply('depth');
  }
  private applyWave() {
    const w = String(this.params.wave);
    if (w === 'random') {
      if (this.osc) {
        stopSource(this.osc);
        this.osc = null;
      }
      this.rnd.connect(this.depth);
      this.nextRnd = 0;
    } else {
      try {
        this.rnd.disconnect(this.depth);
      } catch {
        /* not connected */
      }
      if (!this.osc) {
        this.osc = this.ctx.createOscillator();
        this.osc.frequency.value = num(this.params.rate, 1);
        this.osc.connect(this.depth);
        this.osc.start();
      }
      this.osc.type = w as OscillatorType;
    }
  }
  output(port: string) {
    return port === 'out' ? this.out : null;
  }
  outputVoices() {
    return 1;
  }
  protected apply(key: string) {
    const depth = num(this.params.depth, 0.3);
    const uni = this.params.polarity === 'unipolar';
    switch (key) {
      case 'wave':
        this.applyWave();
        break;
      case 'rate':
        if (this.osc) setSmooth(this.ctx, this.osc.frequency, num(this.params.rate, 1), 0.05);
        break;
      case 'depth':
      case 'polarity':
        setSmooth(this.ctx, this.depth.gain, uni ? depth / 2 : depth);
        setSmooth(this.ctx, this.offset.offset, uni ? depth / 2 : 0);
        break;
    }
  }
  /** Called by the engine clock; drives the smooth-random shape. */
  tick(until: number) {
    if (this.params.wave !== 'random') return;
    const period = 1 / num(this.params.rate, 1);
    const now = this.ctx.currentTime;
    if (this.nextRnd < now) this.nextRnd = now;
    while (this.nextRnd < until) {
      this.rnd.offset.setTargetAtTime(Math.random() * 2 - 1, this.nextRnd, period / 5);
      this.nextRnd += period;
    }
  }
  dispose() {
    if (this.osc) stopSource(this.osc);
    super.dispose();
  }
}

// ---------------------------------------------------------------- VCA / Mixer

class VcaRuntime extends Base {
  private amps: GainNode[] = [];
  private cvs: GainNode[] = [];
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    for (let i = 0; i < voices; i++) {
      const a = this.gain(num(this.params.gain));
      const cv = this.gain(1);
      cv.connect(a.gain);
      this.amps.push(a);
      this.cvs.push(cv);
    }
  }
  output(port: string, voice: number) {
    return port === 'out' ? this.amps[voice] ?? null : null;
  }
  input(port: string, voice: number) {
    return port === 'in' ? this.amps[voice] ?? null : port === 'cv' ? this.cvs[voice] ?? null : null;
  }
  protected apply(key: string) {
    if (key === 'gain') for (const a of this.amps) setSmooth(this.ctx, a.gain, num(this.params.gain));
  }
}

class MixerRuntime extends Base {
  private ins: GainNode[][] = []; // [voice][channel]
  private outs: GainNode[] = [];
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    for (let v = 0; v < voices; v++) {
      const out = this.gain(1);
      const chans = [1, 2, 3, 4].map((ch) => {
        const g = this.gain(num(this.params['level' + ch], 0.7));
        g.connect(out);
        return g;
      });
      this.ins.push(chans);
      this.outs.push(out);
    }
  }
  output(port: string, voice: number) {
    return port === 'out' ? this.outs[voice] ?? null : null;
  }
  input(port: string, voice: number) {
    const m = /^in([1-4])$/.exec(port);
    return m ? this.ins[voice]?.[+m[1] - 1] ?? null : null;
  }
  protected apply(key: string) {
    const m = /^level([1-4])$/.exec(key);
    if (!m) return;
    for (const chans of this.ins) setSmooth(this.ctx, chans[+m[1] - 1].gain, num(this.params[key]));
  }
}

// ---------------------------------------------------------------- Delay

const SYNC_BEATS: Record<string, number> = { '1/16': 0.25, '1/8': 0.5, '1/8.': 0.75, '1/4': 1, '1/4.': 1.5, '1/2': 2 };

class DelayRuntime extends Base {
  private in: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private out: GainNode;
  private chain: { dl: DelayNode; dr: DelayNode; tl: BiquadFilterNode; tr: BiquadFilterNode; hp: BiquadFilterNode; fl: GainNode; fr: GainNode; merge: ChannelMergerNode } | null = null;
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.in = this.gain(1);
    this.dry = this.gain(1);
    this.wet = this.gain(0);
    this.out = this.gain(1);
    this.out.channelCount = 2;
    this.in.connect(this.dry).connect(this.out);
    this.wet.connect(this.out);
    this.buildChain();
    this.apply('mix');
  }
  private delayTime(): number {
    const sync = String(this.params.sync);
    if (sync !== 'free' && SYNC_BEATS[sync]) return Math.min(1.9, (60 / this.host.tempo()) * SYNC_BEATS[sync]);
    return num(this.params.time, 0.35);
  }
  /** (Re)create the delay lines — also used to flush echoes on panic. */
  buildChain() {
    const ctx = this.ctx;
    if (this.chain) for (const n of Object.values(this.chain)) safeDisconnect(n);
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    const tl = ctx.createBiquadFilter();
    const tr = ctx.createBiquadFilter();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    tl.type = tr.type = 'lowpass';
    const fl = ctx.createGain();
    const fr = ctx.createGain();
    const merge = ctx.createChannelMerger(2);
    const t = this.delayTime();
    dl.delayTime.value = t;
    dr.delayTime.value = t;
    // Ping-pong: input → L → R → L ...
    this.in.connect(hp).connect(dl);
    dl.connect(tl).connect(fl).connect(dr);
    dr.connect(tr).connect(fr).connect(dl);
    dl.connect(merge, 0, 0);
    dr.connect(merge, 0, 1);
    merge.connect(this.wet);
    this.chain = { dl, dr, tl, tr, hp, fl, fr, merge };
    this.apply('tone', true);
    this.apply('feedback', true);
  }
  output(port: string) {
    return port === 'out' ? this.out : null;
  }
  outputVoices() {
    return 1;
  }
  input(port: string) {
    return port === 'in' ? this.in : null;
  }
  retime() {
    if (!this.chain) return;
    const t = this.delayTime();
    setSmooth(this.ctx, this.chain.dl.delayTime, t, 0.06);
    setSmooth(this.ctx, this.chain.dr.delayTime, t, 0.06);
  }
  protected apply(key: string, init = false) {
    const c = this.chain;
    if (!c) return;
    const set = (p: AudioParam, v: number) => (init ? (p.value = v) : setSmooth(this.ctx, p, v));
    switch (key) {
      case 'sync':
      case 'time':
        this.retime();
        break;
      case 'feedback': {
        const f = num(this.params.feedback, 0.4);
        set(c.fl.gain, f);
        set(c.fr.gain, f);
        break;
      }
      case 'tone':
        set(c.tl.frequency, num(this.params.tone, 3000));
        set(c.tr.frequency, num(this.params.tone, 3000));
        break;
      case 'mix': {
        const m = num(this.params.mix, 0.3);
        set(this.dry.gain, 1 - m * 0.5);
        set(this.wet.gain, m * 1.1);
        break;
      }
    }
  }
  dispose() {
    if (this.chain) for (const n of Object.values(this.chain)) safeDisconnect(n);
    super.dispose();
  }
}

// ---------------------------------------------------------------- Reverb

function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.min(12, seconds * 1.1)));
  const buf = ctx.createBuffer(2, len, rate);
  const pre = Math.floor(rate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const env = Math.pow(10, (-3 * t) / seconds); // -60 dB at `seconds`
      // Gentle one-pole lowpass whose smoothing increases over time: tails get darker.
      const k = 0.15 + 0.8 * Math.min(1, t / seconds);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * env * (1 + (1 - k));
    }
    // Soft fade-in of early reflections.
    for (let i = pre; i < Math.min(len, pre + 256); i++) d[i] *= (i - pre) / 256;
  }
  return buf;
}

class ReverbRuntime extends Base {
  private in: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private tone: BiquadFilterNode;
  private out: GainNode;
  private conv: ConvolverNode | null = null;
  private convGain: GainNode | null = null;
  private regen: ReturnType<typeof setTimeout> | null = null;
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.in = this.gain(1);
    this.dry = this.gain(1);
    this.wet = this.gain(0);
    this.tone = this.track(this.ctx.createBiquadFilter());
    this.tone.type = 'lowpass';
    this.out = this.gain(1);
    this.in.connect(this.dry).connect(this.out);
    this.tone.connect(this.wet).connect(this.out);
    this.rebuild(true);
    this.apply('tone');
    this.apply('mix');
  }
  /** Build a new convolver and crossfade to it (also used to flush tails on panic). */
  rebuild(immediate = false) {
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, num(this.params.size, 3));
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.value = immediate ? 1 : 0;
    if (!immediate) g.gain.setTargetAtTime(1, t, 0.08);
    this.in.connect(conv).connect(g).connect(this.tone);
    const oldConv = this.conv;
    const oldGain = this.convGain;
    if (oldConv && oldGain) {
      if (immediate) {
        safeDisconnect(oldConv);
        safeDisconnect(oldGain);
      } else {
        oldGain.gain.setTargetAtTime(0, t, 0.08);
        setTimeout(() => {
          safeDisconnect(oldConv);
          safeDisconnect(oldGain);
        }, 700);
      }
    }
    this.conv = conv;
    this.convGain = g;
  }
  output(port: string) {
    return port === 'out' ? this.out : null;
  }
  outputVoices() {
    return 1;
  }
  input(port: string) {
    return port === 'in' ? this.in : null;
  }
  protected apply(key: string) {
    switch (key) {
      case 'size':
        if (this.regen) clearTimeout(this.regen);
        this.regen = setTimeout(() => this.rebuild(), 120);
        break;
      case 'tone':
        setSmooth(this.ctx, this.tone.frequency, num(this.params.tone, 6000));
        break;
      case 'mix': {
        const m = num(this.params.mix, 0.3);
        setSmooth(this.ctx, this.dry.gain, 1 - m * 0.55);
        setSmooth(this.ctx, this.wet.gain, m * 1.4);
        break;
      }
    }
  }
  dispose() {
    if (this.regen) clearTimeout(this.regen);
    safeDisconnect(this.conv);
    safeDisconnect(this.convGain);
    super.dispose();
  }
}

// ---------------------------------------------------------------- Output

class OutputRuntime extends Base {
  readonly in: GainNode;
  constructor(host: RuntimeHost, m: PatchModule, voices: number, master: AudioNode) {
    super(host, m, voices);
    this.in = this.gain(num(this.params.level, 0.8));
    this.in.connect(master);
  }
  output() {
    return null;
  }
  input(port: string) {
    return port === 'in' ? this.in : null;
  }
  protected apply(key: string) {
    if (key === 'level') setSmooth(this.ctx, this.in.gain, num(this.params.level, 0.8));
  }
}

// ---------------------------------------------------------------- Keys

class KeysRuntime extends Base {
  private pitch: ConstantSourceNode[] = [];
  private pitchOut: GainNode[] = [];
  private bend: ConstantSourceNode;
  private mod: ConstantSourceNode;
  private modOut: GainNode;
  /** voice → note currently assigned (transposed) or -1 */
  private voiceNote: number[] = [];
  private voiceHeld: boolean[] = [];
  private voiceAge: number[] = [];
  private age = 0;
  /** mono note stack (physical notes) */
  private stack: number[] = [];
  private physToVoice = new Map<number, number>();
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.bend = this.constant(0);
    this.mod = this.constant(0);
    this.modOut = this.gain(1);
    this.mod.connect(this.modOut);
    for (let i = 0; i < voices; i++) {
      const c = this.constant(0);
      const o = this.gain(1);
      c.connect(o);
      this.bend.connect(o);
      this.pitch.push(c);
      this.pitchOut.push(o);
      this.voiceNote.push(-1);
      this.voiceHeld.push(false);
      this.voiceAge.push(0);
    }
  }
  output(port: string, voice: number) {
    if (port === 'pitch') return this.pitchOut[voice] ?? null;
    if (port === 'mod') return this.modOut;
    return null;
  }
  outputVoices(port: string) {
    return port === 'mod' ? 1 : this.voices;
  }
  protected apply(_key: string) {
    /* voices/glide/octave read on demand; voices change triggers a rebuild */
  }
  private transposed(note: number) {
    return note + 12 * num(this.params.octave);
  }
  private setPitch(v: number, note: number, t: number, glide: boolean) {
    const p = this.pitch[v].offset;
    const target = (note - 69) / 12;
    const g = num(this.params.glide);
    p.cancelScheduledValues(t);
    if (glide && g > 0.001) p.setTargetAtTime(target, t, g / 3);
    else p.setValueAtTime(target, t);
  }
  noteOn(note: number, velocity: number) {
    const t = this.ctx.currentTime;
    const tn = this.transposed(note);
    if (this.voices === 1) {
      const legato = this.stack.length > 0;
      this.stack = this.stack.filter((n) => n !== note);
      this.stack.push(note);
      this.setPitch(0, tn, t, this.voiceNote[0] >= 0);
      this.voiceNote[0] = tn;
      this.voiceHeld[0] = true;
      this.host.emitGate(this.id, 'gate', { type: 'on', voice: 0, note: tn, velocity, time: t, legato });
      return;
    }
    // Poly: retrigger same note's voice, else a free voice, else steal the oldest.
    let v = this.physToVoice.get(note);
    if (v === undefined) {
      let best = -1;
      for (let i = 0; i < this.voices; i++) {
        if (!this.voiceHeld[i] && (best < 0 || this.voiceAge[i] < this.voiceAge[best])) best = i;
      }
      if (best < 0) {
        best = 0;
        for (let i = 1; i < this.voices; i++) if (this.voiceAge[i] < this.voiceAge[best]) best = i;
        for (const [n, vv] of this.physToVoice) if (vv === best) this.physToVoice.delete(n);
      }
      v = best;
    }
    this.physToVoice.set(note, v);
    this.setPitch(v, tn, t, false);
    this.voiceNote[v] = tn;
    this.voiceHeld[v] = true;
    this.voiceAge[v] = ++this.age;
    this.host.emitGate(this.id, 'gate', { type: 'on', voice: v, note: tn, velocity, time: t });
  }
  noteOff(note: number) {
    const t = this.ctx.currentTime;
    if (this.voices === 1) {
      const wasTop = this.stack[this.stack.length - 1] === note;
      this.stack = this.stack.filter((n) => n !== note);
      if (!wasTop) return;
      if (this.stack.length) {
        const back = this.transposed(this.stack[this.stack.length - 1]);
        this.setPitch(0, back, t, true);
        this.voiceNote[0] = back;
        this.host.emitGate(this.id, 'gate', { type: 'on', voice: 0, note: back, velocity: 0.8, time: t, legato: true });
      } else {
        this.voiceHeld[0] = false;
        this.host.emitGate(this.id, 'gate', { type: 'off', voice: 0, note: this.voiceNote[0], velocity: 0, time: t });
      }
      return;
    }
    const v = this.physToVoice.get(note);
    if (v === undefined) return;
    this.physToVoice.delete(note);
    this.voiceHeld[v] = false;
    this.voiceAge[v] = ++this.age;
    this.host.emitGate(this.id, 'gate', { type: 'off', voice: v, note: this.voiceNote[v], velocity: 0, time: t });
  }
  allOff() {
    for (const n of [...this.stack, ...this.physToVoice.keys()]) this.noteOff(n);
    this.stack = [];
    this.physToVoice.clear();
  }
  setMod(v: number) {
    setSmooth(this.ctx, this.mod.offset, v, 0.02);
  }
  setBend(semis: number) {
    setSmooth(this.ctx, this.bend.offset, semis / 12, 0.01);
  }
}

// ---------------------------------------------------------------- Sequencer

const RATE_BEATS: Record<string, number> = { '1/32': 0.125, '1/16': 0.25, '1/8': 0.5, '1/4': 1, '1/2': 2, '1/1': 4 };

class SeqRuntime extends Base {
  private pitch: ConstantSourceNode;
  private pitchOut: GainNode;
  private steps: SeqStep[];
  private nextTime = 0;
  private stepIndex = 0;
  private stepCount = 0;
  private running = false;
  private transpose = 0;
  private gateOpen = false;
  private prevSlide = false;
  private lastNote = 60;
  /** Scheduled (time, step) pairs for the visual playhead. */
  private marks: { time: number; step: number }[] = [];
  constructor(host: RuntimeHost, m: PatchModule, voices: number) {
    super(host, m, voices);
    this.pitch = this.constant(0);
    this.pitchOut = this.gain(1);
    this.pitch.connect(this.pitchOut);
    this.steps = (m.data?.steps ?? []).map((s) => ({ ...s }));
  }
  output(port: string) {
    return port === 'pitch' ? this.pitchOut : null;
  }
  outputVoices() {
    return 1;
  }
  protected apply(_key: string) {
    /* params are read at schedule time */
  }
  setData(d: SeqData) {
    this.steps = d.steps.map((s) => ({ ...s }));
  }
  gate(port: string, ev: GateEvent) {
    if (port === 'transpose' && ev.type === 'on') this.transpose = ev.note - 60;
  }
  start(t0: number) {
    this.running = true;
    this.nextTime = t0;
    this.stepIndex = 0;
    this.stepCount = 0;
    this.marks = [];
    this.prevSlide = false;
  }
  stop() {
    this.running = false;
    this.marks = [];
    if (this.gateOpen) {
      this.gateOpen = false;
      this.host.emitGate(this.id, 'gate', { type: 'off', voice: 0, note: this.lastNote, velocity: 0, time: this.ctx.currentTime });
    }
  }
  currentStep(now: number): number {
    if (!this.running) return -1;
    let cur = -1;
    for (const m of this.marks) if (m.time <= now) cur = m.step;
    // prune old marks
    while (this.marks.length > 2 && this.marks[1].time <= now) this.marks.shift();
    return cur;
  }
  private stepDur() {
    return (60 / this.host.tempo()) * (RATE_BEATS[String(this.params.rate)] ?? 0.25);
  }
  schedule(until: number) {
    if (!this.running) return;
    const len = Math.max(1, Math.min(16, Math.round(num(this.params.length, 16))));
    while (this.nextTime < until) {
      const dur = this.stepDur();
      const i = this.stepIndex % len;
      if (i === 0 && this.stepCount > 0) this.wander(len);
      const swing = num(this.params.swing) * dur * 0.66;
      const t = this.nextTime + (this.stepCount % 2 === 1 ? swing : 0);
      this.playStep(i, t, dur, len);
      this.marks.push({ time: t, step: i });
      this.stepIndex = (i + 1) % len;
      this.stepCount++;
      this.nextTime += dur;
    }
  }
  private playStep(i: number, t: number, dur: number, len: number) {
    const s = this.steps[i];
    const chance = num(this.params.chance, 1);
    const plays = !!s && s.on && (chance >= 1 || Math.random() < chance);
    if (!plays) {
      if (this.gateOpen) {
        this.gateOpen = false;
        this.host.emitGate(this.id, 'gate', { type: 'off', voice: 0, note: this.lastNote, velocity: 0, time: t });
      }
      this.prevSlide = false;
      return;
    }
    const note = Math.max(0, Math.min(127, num(this.params.root, 48) + s.note + this.transpose));
    const p = this.pitch.offset;
    const target = (note - 69) / 12;
    const legato = this.prevSlide && this.gateOpen;
    p.cancelScheduledValues(t);
    if (legato) p.setTargetAtTime(target, t, Math.min(0.06, dur / 3));
    else p.setValueAtTime(target, t);
    const velocity = s.accent ? 1 : 0.72;
    this.host.emitGate(this.id, 'gate', { type: 'on', voice: 0, note, velocity, time: t, legato });
    this.lastNote = note;
    this.gateOpen = true;
    const next = this.steps[(i + 1) % len];
    const holds = s.slide && next?.on;
    if (!holds) {
      const off = t + Math.max(0.01, dur * num(this.params.gate, 0.5));
      this.host.emitGate(this.id, 'gate', { type: 'off', voice: 0, note, velocity: 0, time: off });
      this.gateOpen = false;
    }
    this.prevSlide = !!holds;
  }
  /** Generative drift: some notes step to neighbouring scale degrees each loop. */
  private wander(len: number) {
    const w = num(this.params.wander);
    if (w <= 0) return;
    const scale = SCALES[String(this.params.scale)] ?? SCALES.minor;
    const pool: number[] = [];
    for (let o = -1; o <= 2; o++) for (const d of scale) pool.push(o * 12 + d);
    let changed = false;
    const steps = this.steps.map((s) => ({ ...s }));
    for (let i = 0; i < len; i++) {
      const s = steps[i];
      if (!s.on || Math.random() > w * 0.35) continue;
      // nearest pool index, then move ±1..2 degrees
      let idx = 0;
      for (let k = 1; k < pool.length; k++) if (Math.abs(pool[k] - s.note) < Math.abs(pool[idx] - s.note)) idx = k;
      const move = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2);
      idx = Math.max(0, Math.min(pool.length - 1, idx + move));
      // pull back toward the root register so melodies don't run away
      if (Math.abs(pool[idx]) > 16) idx = Math.max(0, Math.min(pool.length - 1, idx - Math.sign(pool[idx]) * 2));
      s.note = pool[idx];
      changed = true;
    }
    if (changed) {
      this.steps = steps;
      this.host.mutateSeq(this.id, { steps: steps.map((s) => ({ ...s })) });
    }
  }
}

// ---------------------------------------------------------------- factory

export type AnyRuntime = Runtime & Partial<{
  noteOn: KeysRuntime['noteOn'];
}>;

export {
  OscRuntime,
  NoiseRuntime,
  FilterRuntime,
  EnvRuntime,
  LfoRuntime,
  VcaRuntime,
  MixerRuntime,
  DelayRuntime,
  ReverbRuntime,
  OutputRuntime,
  KeysRuntime,
  SeqRuntime,
};

export function createRuntime(host: RuntimeHost, m: PatchModule, voices: number, master: AudioNode): Runtime {
  switch (m.type) {
    case 'osc':
      return new OscRuntime(host, m, voices);
    case 'noise':
      return new NoiseRuntime(host, m, 1);
    case 'filter':
      return new FilterRuntime(host, m, voices);
    case 'env':
      return new EnvRuntime(host, m, voices);
    case 'lfo':
      return new LfoRuntime(host, m, 1);
    case 'vca':
      return new VcaRuntime(host, m, voices);
    case 'mixer':
      return new MixerRuntime(host, m, voices);
    case 'delay':
      return new DelayRuntime(host, m, 1);
    case 'reverb':
      return new ReverbRuntime(host, m, 1);
    case 'output':
      return new OutputRuntime(host, m, 1, master);
    case 'keys':
      return new KeysRuntime(host, m, voices);
    case 'seq':
      return new SeqRuntime(host, m, 1);
  }
}
