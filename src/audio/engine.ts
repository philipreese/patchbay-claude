import type { EngineEvent, EngineListener, EngineView } from './engineApi';
import type { PatchStore, StoreEvent } from '../core/store';
import type { Cable, GateEvent, PatchModule, PortRef, SeqData } from '../core/types';
import { getModuleDef } from '../core/moduleDefs';
import { createRuntime, makeNoiseBuffers, DelayRuntime, EnvRuntime, KeysRuntime, LfoRuntime, ReverbRuntime, SeqRuntime, type Runtime, type RuntimeHost } from './runtimes';

interface Meter {
  sum: GainNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  level: number;
  frame: number;
}

interface Wiring {
  pairs: [AudioNode, AudioNode][];
  extra: AudioNode[];
}

const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 25;

/** Perceptual master volume curve. */
const volToGain = (v: number) => v * v;

export class Engine implements EngineView {
  ctx: AudioContext | null = null;
  started = false;
  playing = false;
  masterVolume = 0.72;
  recording = false;
  heldNotes: number[] = [];

  private listeners = new Set<EngineListener>();
  private runtimes = new Map<string, Runtime>();
  private voiceCount = new Map<string, number>();
  private wiring = new Map<string, Wiring>();
  private meters = new Map<string, Meter>();
  private gateActivity = new Map<string, number>();
  private noiseBufs: Record<string, AudioBuffer> | null = null;
  private host!: RuntimeHost;

  private masterIn!: GainNode; // sum of Output modules
  private fader!: GainNode; // fades on load/panic
  private volume!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private masterAnalyser!: AnalyserNode;
  private probeAnalyser!: AnalyserNode;
  private probeSource: AudioNode | null = null;
  private recorder: { stop(): Promise<Blob>; seconds: number } | null = null;

  private clock: Worker | null = null;
  private frame = 0;
  private mutatingFromEngine = false;

  constructor(private store: PatchStore) {
    store.subscribe((ev) => this.onStore(ev));
    const loop = () => {
      this.frame++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(fn: EngineListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(ev: EngineEvent) {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ------------------------------------------------------------------ lifecycle

  async start() {
    if (!this.ctx) {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) {
        this.emit({ type: 'error', message: 'This browser does not support Web Audio.' });
        throw new Error('Web Audio unsupported');
      }
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.noiseBufs = makeNoiseBuffers(ctx);
      this.host = {
        ctx,
        emitGate: (m, p, ev) => this.routeGate(m, p, ev),
        tempo: () => this.store.patch.tempo,
        noise: (c) => this.noiseBufs![c] ?? this.noiseBufs!.white,
        mutateSeq: (m, d) => this.onSeqMutate(m, d),
      };
      this.masterIn = ctx.createGain();
      this.fader = ctx.createGain();
      this.volume = ctx.createGain();
      this.volume.gain.value = volToGain(this.masterVolume);
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 4;
      this.limiter.ratio.value = 16;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.2;
      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 2048;
      this.masterAnalyser.smoothingTimeConstant = 0.75;
      this.probeAnalyser = ctx.createAnalyser();
      this.probeAnalyser.fftSize = 2048;
      this.probeAnalyser.smoothingTimeConstant = 0.75;
      this.masterIn.connect(this.fader).connect(this.volume).connect(this.limiter);
      this.limiter.connect(this.masterAnalyser);
      this.limiter.connect(ctx.destination);
      this.buildAll();
      this.startClock();
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') this.emit({ type: 'started' });
      });
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* resume can reject on some browsers when not in a gesture */
      }
    }
    this.started = true;
    this.emit({ type: 'started' });
  }

  private startClock() {
    const tick = () => this.tick();
    try {
      // A worker timer keeps the sequencer steady when the tab is in the background.
      const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${TICK_MS});}else{clearInterval(id);}}`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.clock = new Worker(url);
      this.clock.onmessage = tick;
      this.clock.postMessage('start');
    } catch {
      setInterval(tick, TICK_MS);
    }
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const until = ctx.currentTime + LOOKAHEAD;
    for (const rt of this.runtimes.values()) {
      if (rt instanceof LfoRuntime) rt.tick(until);
      if (this.playing && rt instanceof SeqRuntime) rt.schedule(until);
    }
  }

  // ------------------------------------------------------------------ graph building

  private buildAll() {
    if (!this.ctx) return;
    for (const id of [...this.runtimes.keys()]) this.destroyModule(id);
    this.wiring.clear();
    this.computeVoices();
    for (const m of this.store.patch.modules) this.createModule(m);
    for (const c of this.store.patch.cables) this.wireCable(c);
    this.refreshProbe();
    if (this.playing) {
      const t0 = this.ctx.currentTime + 0.05;
      for (const rt of this.runtimes.values()) if (rt instanceof SeqRuntime) rt.start(t0);
    }
  }

  /** Propagate polyphony: poly-capable modules adopt the voice count of their inputs. */
  private computeVoices(): Map<string, number> {
    const patch = this.store.patch;
    const vc = new Map<string, number>();
    const byId = new Map(patch.modules.map((m) => [m.id, m]));
    for (const m of patch.modules) vc.set(m.id, m.type === 'keys' ? Math.max(1, Math.min(8, Math.round(Number(m.params.voices) || 1))) : 1);
    const outVoices = (id: string, port: string) => {
      const m = byId.get(id);
      if (!m) return 1;
      const def = getModuleDef(m.type)!;
      if (def.outputs.find((p) => p.id === port)?.mono) return 1;
      return vc.get(id) ?? 1;
    };
    for (let iter = 0; iter < patch.modules.length + 1; iter++) {
      let changed = false;
      for (const m of patch.modules) {
        const def = getModuleDef(m.type)!;
        if (!def.polyCapable) continue;
        let v = 1;
        for (const c of patch.cables) if (c.to.module === m.id) v = Math.max(v, outVoices(c.from.module, c.from.port));
        if (vc.get(m.id) !== v) {
          vc.set(m.id, v);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const prev = this.voiceCount;
    this.voiceCount = vc;
    return prev;
  }

  private createModule(m: PatchModule) {
    if (!this.ctx) return;
    const voices = this.voiceCount.get(m.id) ?? 1;
    let rt: Runtime;
    try {
      rt = createRuntime(this.host, m, voices, this.masterIn);
    } catch (e) {
      console.error('module failed', m, e);
      return;
    }
    this.runtimes.set(m.id, rt);
    const def = getModuleDef(m.type)!;
    for (const p of def.outputs) {
      if (p.kind === 'gate') continue;
      const sum = this.ctx.createGain();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      sum.connect(analyser);
      const n = rt.outputVoices(p.id);
      for (let v = 0; v < n; v++) rt.output(p.id, v)?.connect(sum);
      this.meters.set(`${m.id}:${p.id}`, { sum, analyser, buf: new Float32Array(new ArrayBuffer(256 * 4)), level: 0, frame: -1 });
    }
  }

  private destroyModule(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    for (const [key, meter] of this.meters) {
      if (key.startsWith(id + ':')) {
        try {
          meter.sum.disconnect();
        } catch {
          /* */
        }
        this.meters.delete(key);
      }
    }
    rt.dispose();
    this.runtimes.delete(id);
  }

  private wireCable(c: Cable) {
    if (!this.ctx) return;
    const src = this.runtimes.get(c.from.module);
    const dst = this.runtimes.get(c.to.module);
    if (!src || !dst) return;
    const sdef = getModuleDef(src.type)!;
    const kind = sdef.outputs.find((p) => p.id === c.from.port)?.kind;
    if (kind === 'gate') return; // gates route through routeGate() via the cable list
    const S = src.outputVoices(c.from.port);
    const D = dst.voices;
    const w: Wiring = { pairs: [], extra: [] };
    const link = (a: AudioNode | null, b: AudioNode | null) => {
      if (!a || !b) return;
      a.connect(b);
      w.pairs.push([a, b]);
    };
    if (S === D) for (let i = 0; i < S; i++) link(src.output(c.from.port, i), dst.input(c.to.port, i));
    else if (S === 1) for (let j = 0; j < D; j++) link(src.output(c.from.port, 0), dst.input(c.to.port, j));
    else if (D === 1) {
      // Summing voices into a mono input: scale so chords don't clip.
      const g = this.ctx.createGain();
      g.gain.value = 1 / Math.sqrt(S);
      w.extra.push(g);
      for (let i = 0; i < S; i++) src.output(c.from.port, i)?.connect(g);
      link(g, dst.input(c.to.port, 0));
    } else for (let i = 0; i < S; i++) link(src.output(c.from.port, i), dst.input(c.to.port, i % D));
    this.wiring.set(c.id, w);
  }

  private unwireCable(id: string) {
    const w = this.wiring.get(id);
    if (!w) return;
    for (const [a, b] of w.pairs) {
      try {
        a.disconnect(b);
      } catch {
        /* already gone */
      }
    }
    for (const n of w.extra) {
      try {
        n.disconnect();
      } catch {
        /* */
      }
    }
    this.wiring.delete(id);
  }

  /** After a structural change: rebuild modules whose voice count changed. */
  private reconcileVoices() {
    const prev = this.computeVoices();
    const changed: string[] = [];
    for (const [id, v] of this.voiceCount) if (prev.get(id) !== v && this.runtimes.has(id)) changed.push(id);
    if (!changed.length) return;
    this.rebuildModules(changed);
  }

  private rebuildModules(ids: string[]) {
    const set = new Set(ids);
    const cables = this.store.patch.cables.filter((c) => set.has(c.from.module) || set.has(c.to.module));
    for (const c of cables) this.unwireCable(c.id);
    for (const id of ids) {
      const wasSeq = this.runtimes.get(id) instanceof SeqRuntime;
      this.destroyModule(id);
      const m = this.store.getModule(id);
      if (m) this.createModule(m);
      if (wasSeq && this.playing) (this.runtimes.get(id) as SeqRuntime | undefined)?.start(this.ctx!.currentTime + 0.05);
    }
    for (const c of cables) this.wireCable(c);
    this.refreshProbe();
  }

  // ------------------------------------------------------------------ store sync

  private onStore(ev: StoreEvent) {
    if (!this.ctx) {
      if (ev.type === 'load') this.playing && this.stop();
      return;
    }
    switch (ev.type) {
      case 'load':
        this.crossfadeLoad();
        break;
      case 'module-add':
        this.computeVoices();
        this.createModule(ev.module);
        if (ev.module.type === 'seq' && this.playing) (this.runtimes.get(ev.module.id) as SeqRuntime).start(this.alignedStart());
        break;
      case 'module-remove':
        for (const c of ev.cables) this.unwireCable(c.id);
        this.destroyModule(ev.id);
        this.reconcileVoices();
        break;
      case 'cable-add':
        this.reconcileVoices();
        if (!this.wiring.has(ev.cable.id)) this.wireCable(ev.cable);
        break;
      case 'cable-remove':
        this.unwireCable(ev.cable.id);
        this.reconcileVoices();
        break;
      case 'param': {
        const rt = this.runtimes.get(ev.id);
        if (!rt) break;
        if (rt instanceof KeysRuntime && ev.key === 'voices') {
          this.releaseAll();
          this.reconcileVoices();
          // keys itself always needs a rebuild when its voice count changes
          if ((this.runtimes.get(ev.id)?.voices ?? 0) !== this.voiceCount.get(ev.id)) this.rebuildModules([ev.id]);
        } else rt.setParam(ev.key, ev.value);
        break;
      }
      case 'data': {
        if (this.mutatingFromEngine) break;
        const m = this.store.getModule(ev.id);
        const rt = this.runtimes.get(ev.id);
        if (m?.data && rt?.setData) rt.setData(m.data);
        break;
      }
      case 'tempo':
        for (const rt of this.runtimes.values()) if (rt instanceof DelayRuntime) rt.retime();
        break;
      case 'probe':
        this.refreshProbe();
        break;
    }
  }

  /** When a sequencer is added mid-play, start it on the next beat of the others. */
  private alignedStart(): number {
    const now = this.ctx!.currentTime;
    const beat = 60 / this.store.patch.tempo;
    return now + 0.05 + (beat - ((now + 0.05) % beat));
  }

  private crossfadeLoad() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.heldNotes = [];
    this.emit({ type: 'notes', held: [] });
    this.fader.gain.cancelScheduledValues(t);
    this.fader.gain.setTargetAtTime(0, t, 0.015);
    setTimeout(() => {
      this.buildAll();
      const t2 = ctx.currentTime;
      this.fader.gain.cancelScheduledValues(t2);
      this.fader.gain.setTargetAtTime(1, t2 + 0.02, 0.03);
    }, 90);
  }

  private onSeqMutate(id: string, data: SeqData) {
    // The sequencer changed its own notes (wander): reflect it in the patch/UI.
    this.mutatingFromEngine = true;
    try {
      this.store.setData(id, data);
    } finally {
      this.mutatingFromEngine = false;
    }
  }

  // ------------------------------------------------------------------ gates

  private routeGate(moduleId: string, port: string, ev: GateEvent) {
    for (const c of this.store.patch.cables) {
      if (c.from.module !== moduleId || c.from.port !== port) continue;
      const dst = this.runtimes.get(c.to.module);
      if (!dst?.gate) continue;
      dst.gate(c.to.port, { ...ev, voice: ev.voice % Math.max(1, dst.voices) });
    }
    // UI notification aligned to when the event is heard.
    const key = `${moduleId}:${port}`;
    const delay = Math.max(0, (ev.time - (this.ctx?.currentTime ?? 0)) * 1000);
    const fire = () => {
      if (ev.type === 'on') this.gateActivity.set(key, performance.now());
      this.emit({ type: 'gate', module: moduleId, port, ev });
    };
    if (delay < 4) fire();
    else setTimeout(fire, delay);
  }

  // ------------------------------------------------------------------ transport

  play() {
    if (!this.ctx) return;
    if (this.playing) return;
    this.playing = true;
    const t0 = this.ctx.currentTime + 0.06;
    for (const rt of this.runtimes.values()) if (rt instanceof SeqRuntime) rt.start(t0);
    this.tick();
    this.emit({ type: 'transport', playing: true });
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    for (const rt of this.runtimes.values()) if (rt instanceof SeqRuntime) rt.stop();
    this.emit({ type: 'transport', playing: false });
  }

  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }

  private releaseAll() {
    for (const rt of this.runtimes.values()) if (rt instanceof KeysRuntime) rt.allOff();
    this.heldNotes = [];
    this.emit({ type: 'notes', held: [] });
  }

  panic() {
    this.stop();
    this.releaseAll();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.fader.gain.cancelScheduledValues(t);
    this.fader.gain.setTargetAtTime(0, t, 0.01);
    for (const rt of this.runtimes.values()) if (rt instanceof EnvRuntime) rt.kill();
    setTimeout(() => {
      // Flush echo and reverb tails, then bring the master back.
      for (const rt of this.runtimes.values()) {
        if (rt instanceof DelayRuntime) rt.buildChain();
        if (rt instanceof ReverbRuntime) rt.rebuild(true);
      }
      const t2 = ctx.currentTime;
      this.fader.gain.cancelScheduledValues(t2);
      this.fader.gain.setTargetAtTime(1, t2 + 0.05, 0.02);
    }, 120);
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.volume.gain.cancelScheduledValues(t);
      this.volume.gain.setTargetAtTime(volToGain(this.masterVolume), t, 0.02);
    }
    this.emit({ type: 'volume', value: this.masterVolume });
  }

  // ------------------------------------------------------------------ playing

  private keys(): KeysRuntime[] {
    return [...this.runtimes.values()].filter((r): r is KeysRuntime => r instanceof KeysRuntime);
  }

  noteOn(note: number, velocity = 0.8) {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    note = Math.round(note);
    if (note < 0 || note > 127) return;
    if (!this.heldNotes.includes(note)) this.heldNotes = [...this.heldNotes, note];
    for (const k of this.keys()) k.noteOn(note, Math.max(0.05, Math.min(1, velocity)));
    this.emit({ type: 'notes', held: this.heldNotes });
  }

  noteOff(note: number) {
    note = Math.round(note);
    if (!this.heldNotes.includes(note)) return;
    this.heldNotes = this.heldNotes.filter((n) => n !== note);
    for (const k of this.keys()) k.noteOff(note);
    this.emit({ type: 'notes', held: this.heldNotes });
  }

  allNotesOff() {
    this.releaseAll();
  }

  setMod(v: number) {
    for (const k of this.keys()) k.setMod(Math.max(0, Math.min(1, v)));
  }

  setBend(semitones: number) {
    for (const k of this.keys()) k.setBend(semitones);
  }

  emitMidi(status: 'unsupported' | 'denied' | 'ready', inputs: string[]) {
    this.emit({ type: 'midi', status, inputs });
  }

  hasKeys(): boolean {
    return this.store.patch.modules.some((m) => m.type === 'keys');
  }

  // ------------------------------------------------------------------ visual state

  getLevel(ref: PortRef): number {
    const key = `${ref.module}:${ref.port}`;
    const meter = this.meters.get(key);
    if (!meter) {
      const t = this.gateActivity.get(key);
      if (t === undefined) return 0;
      return Math.max(0, 1 - (performance.now() - t) / 250);
    }
    if (meter.frame !== this.frame) {
      meter.frame = this.frame;
      meter.analyser.getFloatTimeDomainData(meter.buf);
      let peak = 0;
      for (let i = 0; i < meter.buf.length; i++) {
        const a = Math.abs(meter.buf[i]);
        if (a > peak) peak = a;
      }
      const lvl = Math.min(1, peak);
      meter.level = lvl > meter.level ? lvl : meter.level * 0.88 + lvl * 0.12;
    }
    return meter.level;
  }

  private refreshProbe() {
    if (!this.ctx) return;
    if (this.probeSource) {
      try {
        this.probeSource.disconnect(this.probeAnalyser);
      } catch {
        /* */
      }
      this.probeSource = null;
    }
    const ref = this.store.probe;
    if (!ref) return;
    const meter = this.meters.get(`${ref.module}:${ref.port}`);
    if (!meter) return;
    meter.sum.connect(this.probeAnalyser);
    this.probeSource = meter.sum;
  }

  getProbeAnalyser(): AnalyserNode | null {
    if (!this.ctx) return null;
    return this.store.probe && this.probeSource ? this.probeAnalyser : this.masterAnalyser;
  }

  getMasterAnalyser(): AnalyserNode | null {
    return this.ctx ? this.masterAnalyser : null;
  }

  getCurrentStep(seqId: string): number {
    const rt = this.runtimes.get(seqId);
    if (!(rt instanceof SeqRuntime) || !this.ctx) return -1;
    return rt.currentStep(this.ctx.currentTime);
  }

  /** Voice count the engine is running for a module (for UI badges). */
  getVoices(id: string): number {
    return this.runtimes.get(id)?.voices ?? 1;
  }

  // ------------------------------------------------------------------ recording

  get recordSeconds(): number {
    return this.recorder?.seconds ?? 0;
  }

  async startRecording() {
    if (!this.ctx) await this.start();
    if (this.recording) return;
    const { MasterRecorder } = await import('./recorder');
    const rec = new MasterRecorder(this.ctx!, this.limiter);
    await rec.start();
    this.recorder = rec;
    this.recording = true;
  }

  async stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return null;
    this.recorder = null;
    this.recording = false;
    return rec.stop();
  }
}

export function createEngine(store: PatchStore): Engine {
  return new Engine(store);
}
