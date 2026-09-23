import { describe, it, expect, beforeEach } from 'vitest';
import type { Patch } from '../../src/core/types';
import { PatchStore, checkConnection, cableColorFor } from '../../src/core/store';
import { bassPatch } from '../../src/presets/index';

// Helper to create a minimal patch for testing
function emptyPatch(): Patch {
  return {
    format: 'patchbay',
    version: 1,
    name: 'Test',
    tempo: 120,
    modules: [],
    cables: [],
    macros: [],
  };
}

describe('checkConnection', () => {
  let patch: Patch;

  beforeEach(() => {
    patch = emptyPatch();
    // Add test modules
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'filter1', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });
    patch.modules.push({ id: 'env1', type: 'env', x: 0, y: 0, params: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1, amount: 1, velocity: 0.5 } });
    patch.modules.push({ id: 'keys1', type: 'keys', x: 0, y: 0, params: { voices: 1, glide: 0, octave: 0 } });
    patch.modules.push({ id: 'mixer1', type: 'mixer', x: 0, y: 0, params: { level1: 0.5, level2: 0.5, level3: 0.5, level4: 0.5 } });
    patch.modules.push({ id: 'delay1', type: 'delay', x: 0, y: 0, params: { sync: 'free', time: 0.5, feedback: 0.5, tone: 1000, mix: 0.5 } });
  });

  it('checkConnection: gate output → audio input rejected with reason', () => {
    const result = checkConnection(patch, { module: 'keys1', port: 'gate' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Gate');
    }
  });

  it('checkConnection: audio output → gate input rejected', () => {
    const result = checkConnection(patch, { module: 'osc1', port: 'out' }, { module: 'env1', port: 'gate' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.includes('Gate') || result.reason.includes('note events')).toBe(true);
    }
  });

  it('checkConnection: unknown port rejected', () => {
    const result = checkConnection(patch, { module: 'osc1', port: 'nonexistent' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(false);
  });

  it('checkConnection: duplicate cable rejected', () => {
    patch.cables.push({ id: 'c1', from: { module: 'osc1', port: 'out' }, to: { module: 'filter1', port: 'in' }, color: 0 });
    const result = checkConnection(patch, { module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('already connected');
    }
  });

  it('checkConnection: self-loop without delay rejected', () => {
    const result = checkConnection(patch, { module: 'filter1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('module');
      expect(result.reason).toContain('Delay');
    }
  });

  it('checkConnection: self-loop with delay allowed', () => {
    const result = checkConnection(patch, { module: 'delay1', port: 'out' }, { module: 'delay1', port: 'in' });
    expect(result.ok).toBe(true);
  });

  it('checkConnection: feedback loop without delay rejected', () => {
    // Create a path: filter -> mixer, then try mixer -> filter (loop)
    patch.cables.push({ id: 'c1', from: { module: 'filter1', port: 'out' }, to: { module: 'mixer1', port: 'in1' }, color: 0 });
    const result = checkConnection(patch, { module: 'mixer1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('feedback loop');
    }
  });

  it('checkConnection: feedback loop with delay allowed', () => {
    // Create a path: filter -> delay, then delay can feed back
    // First connection to establish path
    patch.cables.push({ id: 'c1', from: { module: 'filter1', port: 'out' }, to: { module: 'delay1', port: 'in' }, color: 0 });
    // Now try the reverse
    const result = checkConnection(patch, { module: 'delay1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(true);
  });

  it('checkConnection: valid connection ok', () => {
    const result = checkConnection(patch, { module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(true);
  });
});

describe('PatchStore.connect', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'filter1', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });
    store = new PatchStore(patch);
  });

  it('connect returns {ok:true, cable} with new unique id', () => {
    const result = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cable.id).toBeDefined();
      expect(result.cable.from.module).toBe('osc1');
      expect(result.cable.from.port).toBe('out');
      expect(result.cable.to.module).toBe('filter1');
      expect(result.cable.to.port).toBe('in');
    }
  });

  it('connect returns different ids for different cables', () => {
    const patch = store.patch;
    patch.modules.push({ id: 'filter2', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });

    const result1 = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });
    const result2 = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter2', port: 'in' });

    if (result1.ok && result2.ok) {
      expect(result1.cable.id).not.toBe(result2.cable.id);
    }
  });

  it('connect emits cable-add event', () => {
    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });

    const cableAddEvent = events.find(ev => ev.type === 'cable-add');
    expect(cableAddEvent).toBeDefined();
    if (cableAddEvent) {
      expect(cableAddEvent.cable.from.module).toBe('osc1');
    }
  });
});

describe('PatchStore.removeCable', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'filter1', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });
    store = new PatchStore(patch);
  });

  it('removeCable emits cable-remove event', () => {
    const connectResult = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });

    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    if (connectResult.ok) {
      store.removeCable(connectResult.cable.id);

      const cableRemoveEvent = events.find(ev => ev.type === 'cable-remove');
      expect(cableRemoveEvent).toBeDefined();
      if (cableRemoveEvent) {
        expect(cableRemoveEvent.cable.id).toBe(connectResult.cable.id);
      }
    }
  });
});

describe('PatchStore.removeModule', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'filter1', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });
    patch.modules.push({ id: 'out', type: 'output', x: 0, y: 0, params: { level: 0.8 } });
    store = new PatchStore(patch);
  });

  it('removeModule removes its cables with cable-remove events', () => {
    const connectResult = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });

    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    if (connectResult.ok) {
      store.removeModule('osc1');

      const cableRemoveEvent = events.find(ev => ev.type === 'cable-remove');
      expect(cableRemoveEvent).toBeDefined();
    }
  });

  it('removeModule emits module-remove event', () => {
    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.removeModule('osc1');

    const moduleRemoveEvent = events.find(ev => ev.type === 'module-remove');
    expect(moduleRemoveEvent).toBeDefined();
    if (moduleRemoveEvent) {
      expect(moduleRemoveEvent.id).toBe('osc1');
    }
  });

  it('removeModule: output module cannot be removed', () => {
    const canRemove = store.canRemove('out');
    expect(canRemove).toBe(false);

    const patchBefore = store.patch.modules.length;
    store.removeModule('out');
    const patchAfter = store.patch.modules.length;

    expect(patchBefore).toBe(patchAfter);
  });

  it('removeModule emits cable-remove before module-remove', () => {
    const connectResult = store.connect({ module: 'osc1', port: 'out' }, { module: 'filter1', port: 'in' });

    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    if (connectResult.ok) {
      store.removeModule('osc1');

      const cableRemoveIdx = events.findIndex(ev => ev.type === 'cable-remove');
      const moduleRemoveIdx = events.findIndex(ev => ev.type === 'module-remove');

      expect(cableRemoveIdx).toBeGreaterThanOrEqual(0);
      expect(moduleRemoveIdx).toBeGreaterThanOrEqual(0);
      expect(cableRemoveIdx).toBeLessThan(moduleRemoveIdx);
    }
  });
});

describe('PatchStore.addModule', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    patch.modules.push({ id: 'out', type: 'output', x: 0, y: 0, params: { level: 0.8 } });
    store = new PatchStore(patch);
  });

  it("addModule('output', ...) returns null when output already exists", () => {
    const result = store.addModule('output', 100, 100);
    expect(result).toBeNull();
  });

  it("addModule('seq', ...) creates 16 empty steps", () => {
    const result = store.addModule('seq', 100, 100);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.data).toBeDefined();
      if (result.data) {
        expect(result.data.steps.length).toBe(16);
        for (const step of result.data.steps) {
          expect(step.on).toBe(false);
          expect(step.note).toBe(0);
          expect(step.accent).toBe(false);
          expect(step.slide).toBe(false);
        }
      }
    }
  });

  it('addModule returns module with unique id', () => {
    const result1 = store.addModule('osc', 100, 100);
    const result2 = store.addModule('osc', 150, 150);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    if (result1 && result2) {
      expect(result1.id).not.toBe(result2.id);
    }
  });

  it('addModule emits module-add event', () => {
    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    const result = store.addModule('osc', 100, 100);

    const moduleAddEvent = events.find(ev => ev.type === 'module-add');
    expect(moduleAddEvent).toBeDefined();
    if (moduleAddEvent && result) {
      expect(moduleAddEvent.module.id).toBe(result.id);
    }
  });
});

describe('PatchStore.setParam', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'filter1', type: 'filter', x: 0, y: 0, params: { mode: 'lowpass', cutoff: 1000, res: 1, drive: 0 } });
    store = new PatchStore(patch);
  });

  it('setParam clamps out-of-range numbers to min', () => {
    store.setParam('osc1', 'octave', -10);
    const module = store.getModule('osc1');
    expect(module?.params.octave).toBeGreaterThanOrEqual(-3);
  });

  it('setParam clamps out-of-range numbers to max', () => {
    store.setParam('osc1', 'octave', 10);
    const module = store.getModule('osc1');
    expect(module?.params.octave).toBeLessThanOrEqual(3);
  });

  it('setParam rejects unknown enum strings and keeps default', () => {
    store.setParam('osc1', 'wave', 'invalid_wave' as any);
    const module = store.getModule('osc1');
    expect(module?.params.wave).toBe('sawtooth');
  });

  it('setParam accepts valid enum strings', () => {
    store.setParam('osc1', 'wave', 'square');
    const module = store.getModule('osc1');
    expect(module?.params.wave).toBe('square');
  });

  it('setParam rounds stepped params', () => {
    store.setParam('osc1', 'octave', 1.7);
    const module = store.getModule('osc1');
    expect(module?.params.octave).toBe(2);
  });

  it('setParam does not emit event when value is unchanged', () => {
    const module = store.getModule('osc1');
    expect(module?.params.wave).toBe('sine');

    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.setParam('osc1', 'wave', 'sine');

    const paramEvent = events.find(ev => ev.type === 'param');
    expect(paramEvent).toBeUndefined();
  });

  it('setParam emits event when value changes', () => {
    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.setParam('osc1', 'wave', 'square');

    const paramEvent = events.find(ev => ev.type === 'param');
    expect(paramEvent).toBeDefined();
    if (paramEvent) {
      expect(paramEvent.key).toBe('wave');
      expect(paramEvent.value).toBe('square');
    }
  });
});

describe('PatchStore macros', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = bassPatch();
    store = new PatchStore(patch);
  });

  it('setMacro(0, 0) sets flt1.cutoff to macro from value', () => {
    store.setMacro(0, 0);
    const module = store.getModule('flt1');
    expect(module?.params.cutoff).toBeDefined();

    const macro = store.patch.macros[0];
    const targetFrom = macro.targets[0]?.from;
    if (targetFrom !== undefined && typeof module?.params.cutoff === 'number') {
      expect(Math.abs(module.params.cutoff - targetFrom) / targetFrom).toBeLessThan(1e-6);
    }
  });

  it('setMacro(0, 1) sets flt1.cutoff to macro to value', () => {
    store.setMacro(0, 1);
    const module = store.getModule('flt1');
    expect(module?.params.cutoff).toBeDefined();

    const macro = store.patch.macros[0];
    const targetTo = macro.targets[0]?.to;
    if (targetTo !== undefined && typeof module?.params.cutoff === 'number') {
      expect(Math.abs(module.params.cutoff - targetTo) / targetTo).toBeLessThan(1e-6);
    }
  });

  it('setMacro(0, 0.5) gives geometric midpoint for log-curve cutoff', () => {
    store.setMacro(0, 0.5);
    const module = store.getModule('flt1');
    const cutoff = module?.params.cutoff as number;

    const macro = store.patch.macros[0];
    const targetFrom = macro.targets[0]?.from;
    const targetTo = macro.targets[0]?.to;

    if (targetFrom !== undefined && targetTo !== undefined) {
      const geometricMidpoint = Math.sqrt(targetFrom * targetTo);
      const relativeError = Math.abs(cutoff - geometricMidpoint) / geometricMidpoint;
      expect(relativeError).toBeLessThan(0.01); // within 1%
    }
  });

  it('getMacro(0) returns approximately the value last set', () => {
    store.setMacro(0, 0.3);
    const retrieved = store.getMacro(0);
    expect(Math.abs(retrieved - 0.3)).toBeLessThan(1e-6);
  });

  it('getMacro(0, 0) then getMacro(0) returns ~0', () => {
    store.setMacro(0, 0);
    const retrieved = store.getMacro(0);
    expect(retrieved).toBeLessThan(0.01);
  });

  it('getMacro(0, 1) then getMacro(0) returns ~1', () => {
    store.setMacro(0, 1);
    const retrieved = store.getMacro(0);
    expect(retrieved).toBeGreaterThan(0.99);
  });
});

describe('PatchStore.setTempo', () => {
  let store: PatchStore;

  beforeEach(() => {
    const patch = emptyPatch();
    store = new PatchStore(patch);
  });

  it('setTempo clamps to minimum 40', () => {
    store.setTempo(30);
    expect(store.patch.tempo).toBe(40);
  });

  it('setTempo clamps to maximum 220', () => {
    store.setTempo(250);
    expect(store.patch.tempo).toBe(220);
  });

  it('setTempo rounds to nearest integer', () => {
    store.setTempo(120.7);
    expect(store.patch.tempo).toBe(121);
  });

  it('setTempo within range accepted as-is', () => {
    store.setTempo(100);
    expect(store.patch.tempo).toBe(100);
  });

  it('setTempo emits tempo event', () => {
    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.setTempo(110);

    const tempoEvent = events.find(ev => ev.type === 'tempo');
    expect(tempoEvent).toBeDefined();
    if (tempoEvent) {
      expect(tempoEvent.tempo).toBe(110);
    }
  });

  it('setTempo does not emit when value unchanged', () => {
    store.patch.tempo = 100;

    const events: any[] = [];
    store.subscribe((ev) => events.push(ev));

    store.setTempo(100);

    const tempoEvent = events.find(ev => ev.type === 'tempo');
    expect(tempoEvent).toBeUndefined();
  });
});

describe('cableColorFor', () => {
  let patch: Patch;

  beforeEach(() => {
    patch = emptyPatch();
    patch.modules.push({ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'sine', octave: 0, tune: 0, fine: 0, unison: 1, spread: 0, fm: 0 } });
    patch.modules.push({ id: 'keys1', type: 'keys', x: 0, y: 0, params: { voices: 1, glide: 0, octave: 0 } });
    patch.modules.push({ id: 'env1', type: 'env', x: 0, y: 0, params: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1, amount: 1, velocity: 0.5 } });
  });

  it('cableColorFor returns 4 for gate output', () => {
    const color = cableColorFor(patch, { module: 'keys1', port: 'gate' });
    expect(color).toBe(4);
  });

  it('cableColorFor returns 1 for pitch output', () => {
    const color = cableColorFor(patch, { module: 'keys1', port: 'pitch' });
    expect(color).toBe(1);
  });

  it('cableColorFor returns 0 for audio output', () => {
    const color = cableColorFor(patch, { module: 'osc1', port: 'out' });
    expect(color).toBe(0);
  });

  it('cableColorFor returns 5 for env cv output', () => {
    const color = cableColorFor(patch, { module: 'env1', port: 'out' });
    expect(color).toBe(5);
  });
});
