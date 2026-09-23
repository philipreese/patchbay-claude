import type { Cable, ConnectResult, Macro, ModuleType, ParamValue, Patch, PatchModule, PortRef, SeqData } from './types';
import { defaultParams, getModuleDef, getParamDef, normToParam, paramToNorm, sanitizeParam } from './moduleDefs';

/**
 * PatchStore is the single source of truth for the patch. The UI mutates the
 * patch only through these methods; the audio engine and every view subscribe
 * to the resulting events. Nothing else should mutate `store.patch` directly.
 */
export type StoreEvent =
  | { type: 'load' }
  | { type: 'module-add'; module: PatchModule }
  | { type: 'module-remove'; id: string; module: PatchModule; cables: Cable[] }
  | { type: 'module-move'; id: string }
  | { type: 'param'; id: string; key: string; value: ParamValue }
  | { type: 'data'; id: string }
  | { type: 'cable-add'; cable: Cable }
  | { type: 'cable-remove'; cable: Cable }
  | { type: 'tempo'; tempo: number }
  | { type: 'meta' }
  | { type: 'select'; id: string | null }
  | { type: 'probe'; ref: PortRef | null };

export type StoreListener = (ev: StoreEvent) => void;

export const CABLE_COLORS = 6;

export function emptySeqData(): SeqData {
  return { steps: Array.from({ length: 16 }, () => ({ on: false, note: 0, accent: false, slide: false })) };
}

export class PatchStore {
  patch: Patch;
  selected: string | null = null;
  /** Port being shown in the scope/spectrum. null = master output. */
  probe: PortRef | null = null;
  private listeners = new Set<StoreListener>();
  private idCounter = 1;
  /** Set by the app so every change is autosaved; debounced there. */
  dirty = false;

  constructor(patch: Patch) {
    this.patch = patch;
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: StoreEvent) {
    if (ev.type !== 'select' && ev.type !== 'probe') this.dirty = true;
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch (err) {
        console.error('store listener failed', ev.type, err);
      }
    }
  }

  getModule(id: string): PatchModule | undefined {
    return this.patch.modules.find((m) => m.id === id);
  }

  /** Replace the whole patch (already validated). */
  load(patch: Patch) {
    this.patch = patch;
    this.selected = null;
    this.probe = null;
    this.idCounter = 1;
    this.emit({ type: 'load' });
    this.emit({ type: 'select', id: null });
    this.emit({ type: 'probe', ref: null });
  }

  private newId(prefix: string): string {
    const taken = new Set([...this.patch.modules.map((m) => m.id), ...this.patch.cables.map((c) => c.id)]);
    let id: string;
    do id = `${prefix}${this.idCounter++}`;
    while (taken.has(id));
    return id;
  }

  addModule(type: ModuleType, x: number, y: number): PatchModule | null {
    const def = getModuleDef(type);
    if (!def) return null;
    if (def.singleton && this.patch.modules.some((m) => m.type === type)) return null;
    const m: PatchModule = { id: this.newId(type), type, x: Math.round(x), y: Math.round(y), params: defaultParams(type) };
    if (type === 'seq') m.data = emptySeqData();
    this.patch.modules.push(m);
    this.emit({ type: 'module-add', module: m });
    return m;
  }

  canRemove(id: string): boolean {
    const m = this.getModule(id);
    return !!m && !getModuleDef(m.type)?.singleton;
  }

  removeModule(id: string) {
    const m = this.getModule(id);
    if (!m || !this.canRemove(id)) return;
    const cables = this.patch.cables.filter((c) => c.from.module === id || c.to.module === id);
    for (const c of cables) this.removeCable(c.id);
    this.patch.modules = this.patch.modules.filter((x) => x.id !== id);
    if (this.selected === id) this.select(null);
    if (this.probe?.module === id) this.setProbe(null);
    this.emit({ type: 'module-remove', id, module: m, cables });
  }

  moveModule(id: string, x: number, y: number) {
    const m = this.getModule(id);
    if (!m) return;
    m.x = Math.round(x);
    m.y = Math.round(y);
    this.emit({ type: 'module-move', id });
  }

  renameModule(id: string, label: string) {
    const m = this.getModule(id);
    if (!m) return;
    m.label = label.slice(0, 32) || undefined;
    this.emit({ type: 'meta' });
  }

  setParam(id: string, key: string, value: ParamValue) {
    const m = this.getModule(id);
    if (!m) return;
    const def = getParamDef(m.type, key);
    if (!def) return;
    const v = sanitizeParam(def, value);
    if (m.params[key] === v) return;
    m.params[key] = v;
    this.emit({ type: 'param', id, key, value: v });
  }

  /** Mutate sequencer data in place then call this. */
  setData(id: string, data: SeqData) {
    const m = this.getModule(id);
    if (!m) return;
    m.data = data;
    this.emit({ type: 'data', id });
  }

  setTempo(bpm: number) {
    const t = Math.min(220, Math.max(40, Math.round(bpm)));
    if (t === this.patch.tempo) return;
    this.patch.tempo = t;
    this.emit({ type: 'tempo', tempo: t });
  }

  setName(name: string) {
    this.patch.name = name.slice(0, 48) || 'Untitled';
    this.emit({ type: 'meta' });
  }

  select(id: string | null) {
    this.selected = id;
    this.emit({ type: 'select', id });
  }

  setProbe(ref: PortRef | null) {
    this.probe = ref;
    this.emit({ type: 'probe', ref });
  }

  /** Validate a prospective connection without making it. */
  checkConnection(from: PortRef, to: PortRef): { ok: true } | { ok: false; reason: string } {
    return checkConnection(this.patch, from, to);
  }

  connect(from: PortRef, to: PortRef, color?: number): ConnectResult {
    const chk = this.checkConnection(from, to);
    if (!chk.ok) return chk;
    const cable: Cable = {
      id: this.newId('c'),
      from: { ...from },
      to: { ...to },
      color: color ?? this.patch.cables.length % CABLE_COLORS,
    };
    this.patch.cables.push(cable);
    this.emit({ type: 'cable-add', cable });
    return { ok: true, cable };
  }

  removeCable(id: string) {
    const cable = this.patch.cables.find((c) => c.id === id);
    if (!cable) return;
    this.patch.cables = this.patch.cables.filter((c) => c.id !== id);
    if (this.probe && this.probe.module === cable.from.module && this.probe.port === cable.from.port) {
      // keep probe: the output still exists
    }
    this.emit({ type: 'cable-remove', cable });
  }

  // ---- Macros (beginner controls) --------------------------------------------------

  /** Current macro position 0..1, derived from the first target's real param value. */
  getMacro(i: number): number {
    const mac = this.patch.macros[i];
    if (!mac || !mac.targets.length) return 0;
    return macroPosition(this.patch, mac);
  }

  setMacro(i: number, pos: number) {
    const mac = this.patch.macros[i];
    if (!mac) return;
    pos = Math.min(1, Math.max(0, pos));
    for (const t of mac.targets) {
      const m = this.getModule(t.module);
      if (!m) continue;
      const def = getParamDef(m.type, t.param);
      if (!def || def.type !== 'number') continue;
      // Interpolate in knob space so log params (cutoff, time) sweep musically.
      const a = paramToNorm(def, t.from);
      const b = paramToNorm(def, t.to);
      this.setParam(t.module, t.param, normToParam(def, a + (b - a) * pos));
    }
  }
}

export function macroPosition(patch: Patch, mac: Macro): number {
  for (const t of mac.targets) {
    const m = patch.modules.find((x) => x.id === t.module);
    if (!m) continue;
    const def = getParamDef(m.type, t.param);
    if (!def || def.type !== 'number') continue;
    const a = paramToNorm(def, t.from);
    const b = paramToNorm(def, t.to);
    if (Math.abs(b - a) < 1e-9) continue;
    const cur = paramToNorm(def, m.params[t.param] as number);
    return Math.min(1, Math.max(0, (cur - a) / (b - a)));
  }
  return 0;
}

/** Pure connection validation (used by the store and the patch loader). */
export function checkConnection(patch: Patch, from: PortRef, to: PortRef): { ok: true } | { ok: false; reason: string } {
  const src = patch.modules.find((m) => m.id === from.module);
  const dst = patch.modules.find((m) => m.id === to.module);
  if (!src || !dst) return { ok: false, reason: 'That module no longer exists.' };
  const sdef = getModuleDef(src.type)!;
  const ddef = getModuleDef(dst.type)!;
  const out = sdef.outputs.find((p) => p.id === from.port);
  const inp = ddef.inputs.find((p) => p.id === to.port);
  if (!out) return { ok: false, reason: `${sdef.title} has no output called “${from.port}”.` };
  if (!inp) return { ok: false, reason: `${ddef.title} has no input called “${to.port}”.` };
  if (out.kind === 'gate' && inp.kind !== 'gate')
    return { ok: false, reason: 'Gate cables carry note events, not sound. Patch them into a Gate input (Envelope) or Transpose.' };
  if (out.kind !== 'gate' && inp.kind === 'gate')
    return { ok: false, reason: `${inp.label} only accepts note events. Use a Gate output (Keys or Sequencer).` };
  if (patch.cables.some((c) => c.from.module === from.module && c.from.port === from.port && c.to.module === to.module && c.to.port === to.port))
    return { ok: false, reason: 'Those ports are already connected.' };
  if (from.module === to.module && src.type !== 'delay') return { ok: false, reason: 'A module can’t feed itself directly — go through a Delay for feedback.' };
  // Web Audio silences feedback loops unless they pass through a delay line.
  if (out.kind !== 'gate' && createsLoopWithoutDelay(patch, from.module, to.module))
    return { ok: false, reason: 'That would make a feedback loop. Loops must pass through a Delay.' };
  return { ok: true };
}

function createsLoopWithoutDelay(patch: Patch, fromId: string, toId: string): boolean {
  // Is there a signal path toId -> ... -> fromId that avoids delay modules?
  const typeOf = new Map(patch.modules.map((m) => [m.id, m.type]));
  if (typeOf.get(fromId) === 'delay' || typeOf.get(toId) === 'delay') return false;
  const adj = new Map<string, string[]>();
  for (const c of patch.cables) {
    const def = getModuleDef(typeOf.get(c.from.module) ?? '');
    const kind = def?.outputs.find((p) => p.id === c.from.port)?.kind;
    if (kind === 'gate') continue;
    if (!adj.has(c.from.module)) adj.set(c.from.module, []);
    adj.get(c.from.module)!.push(c.to.module);
  }
  const seen = new Set<string>();
  const stack = [toId];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === fromId) return true;
    if (seen.has(n) || typeOf.get(n) === 'delay') continue;
    seen.add(n);
    for (const nx of adj.get(n) ?? []) stack.push(nx);
  }
  return false;
}
