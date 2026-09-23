import { describe, expect, it } from 'vitest';
import { parsePatch, serializePatch } from '../../src/core/serialize';
import { PRESETS } from '../../src/presets/index';
import type { Patch } from '../../src/core/types';

describe('parsePatch: preset round-trip', () => {
  for (const preset of PRESETS) {
    it(`round-trips ${preset.id} unchanged`, () => {
      const original = preset.make();
      const json = serializePatch(original);
      const { patch, warnings, error } = parsePatch(json);
      expect(error).toBeUndefined();
      expect(warnings).toEqual([]);
      expect(patch).not.toBeNull();
      expect(patch!.name).toBe(original.name);
      expect(patch!.tempo).toBe(original.tempo);
      expect(patch!.modules.length).toBe(original.modules.length);
      expect(patch!.cables.length).toBe(original.cables.length);
      expect(patch!.macros.length).toBe(original.macros.length);
      // Full structural equality via JSON (order preserved by our sanitiser).
      expect(JSON.parse(serializePatch(patch!))).toEqual(JSON.parse(json));
    });
  }
});

describe('parsePatch: malformed input never throws', () => {
  const badInputs: unknown[] = [
    null,
    undefined,
    42,
    'garbage',
    '{not json',
    {},
    [],
    true,
    { format: 'somethingelse' },
    { format: 'patchbay', modules: 'nope' },
    { format: 'patchbay', modules: [{ type: 'not-a-real-type' }] },
    { format: 'patchbay', cables: 'nope' },
    { format: 'patchbay', macros: 'nope' },
  ];

  for (const [i, input] of badInputs.entries()) {
    it(`handles bad input #${i} without throwing`, () => {
      expect(() => parsePatch(input)).not.toThrow();
      const result = parsePatch(input);
      expect(result).toBeTruthy();
    });
  }

  it('rejects null', () => {
    const { patch, error } = parsePatch(null);
    expect(patch).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects a number', () => {
    const { patch, error } = parsePatch(42);
    expect(patch).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects a garbage string', () => {
    const { patch, error } = parsePatch('garbage');
    expect(patch).toBeNull();
    expect(error).toBeTruthy();
  });

  it('accepts {} and produces a minimal valid patch with an output module', () => {
    const { patch, error } = parsePatch({});
    expect(error).toBeUndefined();
    expect(patch).not.toBeNull();
    expect(patch!.modules.some((m) => m.type === 'output')).toBe(true);
  });

  it('rejects a wrong format tag', () => {
    const { patch, error } = parsePatch({ format: 'not-patchbay', modules: [] });
    expect(patch).toBeNull();
    expect(error).toBeTruthy();
  });

  it('ignores non-array modules', () => {
    const { patch, warnings } = parsePatch({ format: 'patchbay', modules: 'not-an-array' });
    expect(patch).not.toBeNull();
    expect(patch!.modules.some((m) => m.type === 'output')).toBe(true);
    expect(warnings.some((w) => /module/i.test(w))).toBe(true);
  });

  it('drops modules with unknown types', () => {
    const { patch, warnings } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'x', type: 'not-a-real-type', x: 0, y: 0 }],
    });
    expect(patch!.modules.some((m) => (m as any).type === 'not-a-real-type')).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('deduplicates duplicate module ids', () => {
    const { patch, warnings } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'osc1', type: 'osc', x: 0, y: 0 },
        { id: 'osc1', type: 'osc', x: 10, y: 10 },
      ],
    });
    const oscModules = patch!.modules.filter((m) => m.type === 'osc');
    expect(oscModules.length).toBe(2);
    const ids = patch!.modules.map((m) => m.id);
    expect(new Set(ids).size).toBe(patch!.modules.length);
    expect(warnings.some((w) => /duplicate/i.test(w))).toBe(true);
  });

  it('sanitises NaN/Infinity/huge params to sane values', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'osc1', type: 'osc', x: NaN, y: Infinity, params: { fine: NaN, spread: Infinity, unison: -Infinity } },
      ],
    });
    const m = patch!.modules.find((mm) => mm.id === 'osc1')!;
    expect(Number.isFinite(m.x)).toBe(true);
    expect(Number.isFinite(m.y)).toBe(true);
    expect(Math.abs(m.x) <= 20000).toBe(true);
    expect(Math.abs(m.y) <= 20000).toBe(true);
    expect(Number.isFinite(m.params.fine as number)).toBe(true);
    expect(Number.isFinite(m.params.spread as number)).toBe(true);
    expect(Number.isFinite(m.params.unison as number)).toBe(true);
  });

  it('accepts numeric strings for params', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'osc1', type: 'osc', x: '10', y: '20', params: { tune: '5' } }],
    });
    const m = patch!.modules.find((mm) => mm.id === 'osc1')!;
    expect(m.x).toBe(10);
    expect(m.y).toBe(20);
    expect(m.params.tune).toBe(5);
  });

  it('falls back to default for bad enum values', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'osc1', type: 'osc', x: 0, y: 0, params: { wave: 'not-a-wave' } }],
    });
    const m = patch!.modules.find((mm) => mm.id === 'osc1')!;
    expect(m.params.wave).toBe('sawtooth'); // osc default
  });

  it('drops cables referencing unknown ports', () => {
    const { patch, warnings } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'osc1', type: 'osc', x: 0, y: 0 },
        { id: 'out', type: 'output', x: 100, y: 0 },
      ],
      cables: [{ id: 'c1', from: { module: 'osc1', port: 'nope' }, to: { module: 'out', port: 'in' } }],
    });
    expect(patch!.cables.length).toBe(0);
    expect(warnings.some((w) => /cable/i.test(w))).toBe(true);
  });

  it('drops gate-to-audio cables', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'keys1', type: 'keys', x: 0, y: 0 },
        { id: 'out', type: 'output', x: 100, y: 0 },
      ],
      cables: [{ id: 'c1', from: { module: 'keys1', port: 'gate' }, to: { module: 'out', port: 'in' } }],
    });
    expect(patch!.cables.length).toBe(0);
  });

  it('drops duplicate cables', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'osc1', type: 'osc', x: 0, y: 0 },
        { id: 'mix1', type: 'mixer', x: 100, y: 0 },
        { id: 'out', type: 'output', x: 200, y: 0 },
      ],
      cables: [
        { id: 'c1', from: { module: 'osc1', port: 'out' }, to: { module: 'mix1', port: 'in1' } },
        { id: 'c2', from: { module: 'osc1', port: 'out' }, to: { module: 'mix1', port: 'in1' } },
      ],
    });
    expect(patch!.cables.length).toBe(1);
  });

  it('drops cables that would create a loop without a delay', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'mix1', type: 'mixer', x: 0, y: 0 },
        { id: 'flt1', type: 'filter', x: 100, y: 0 },
      ],
      cables: [
        { id: 'c1', from: { module: 'mix1', port: 'out' }, to: { module: 'flt1', port: 'in' } },
        { id: 'c2', from: { module: 'flt1', port: 'out' }, to: { module: 'mix1', port: 'in1' } },
      ],
    });
    // Second cable would close a loop with no delay in the path -> dropped.
    expect(patch!.cables.length).toBe(1);
  });

  it('allows loop cables that pass through a delay', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'dly1', type: 'delay', x: 0, y: 0 },
        { id: 'mix1', type: 'mixer', x: 100, y: 0 },
      ],
      cables: [
        { id: 'c1', from: { module: 'dly1', port: 'out' }, to: { module: 'mix1', port: 'in1' } },
        { id: 'c2', from: { module: 'mix1', port: 'out' }, to: { module: 'dly1', port: 'in' } },
      ],
    });
    expect(patch!.cables.length).toBe(2);
  });

  it('adds a missing output module', () => {
    const { patch, warnings } = parsePatch({ format: 'patchbay', modules: [{ id: 'osc1', type: 'osc', x: 0, y: 0 }] });
    expect(patch!.modules.filter((m) => m.type === 'output').length).toBe(1);
    expect(warnings.some((w) => /output/i.test(w))).toBe(true);
  });

  it('drops extra output modules, keeping one', () => {
    const { patch, warnings } = parsePatch({
      format: 'patchbay',
      modules: [
        { id: 'out1', type: 'output', x: 0, y: 0 },
        { id: 'out2', type: 'output', x: 100, y: 0 },
      ],
    });
    expect(patch!.modules.filter((m) => m.type === 'output').length).toBe(1);
    expect(warnings.some((w) => /output/i.test(w))).toBe(true);
  });

  it('caps modules at 64', () => {
    const modules = Array.from({ length: 10000 }, (_, i) => ({ id: `osc${i}`, type: 'osc', x: i, y: i }));
    const { patch, warnings } = parsePatch({ format: 'patchbay', modules });
    expect(patch!.modules.length).toBeLessThanOrEqual(64);
    expect(warnings.some((w) => /64/.test(w))).toBe(true);
  });

  it('ignores prototype-pollution style keys and does not pollute Object.prototype', () => {
    const raw = '{"format":"patchbay","modules":[{"id":"osc1","type":"osc","x":0,"y":0,"__proto__":{"polluted":true},"params":{"__proto__":{"polluted":true}}}]}';
    expect(() => parsePatch(raw)).not.toThrow();
    const { patch, error } = parsePatch(raw);
    expect(error).toBeUndefined();
    expect(patch).not.toBeNull();
    expect((Object.prototype as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });

  it('normalises seq step data to exactly 16 steps', () => {
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'seq1', type: 'seq', x: 0, y: 0, data: { steps: [{ on: true, note: 999, accent: true, slide: false }] } }],
    });
    const m = patch!.modules.find((mm) => mm.id === 'seq1')!;
    expect(m.data!.steps.length).toBe(16);
    expect(m.data!.steps[0].note).toBe(24); // clamped
    expect(m.data!.steps[1].on).toBe(false); // filled from empty
  });

  it('caps macros at 6 and drops macros with no valid targets', () => {
    const targets = Array.from({ length: 10 }, (_, i) => ({
      label: `M${i}`,
      targets: [{ module: 'osc1', param: 'tune', from: 0, to: 1 }],
    }));
    const { patch } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'osc1', type: 'osc', x: 0, y: 0 }],
      macros: targets,
    });
    expect(patch!.macros.length).toBeLessThanOrEqual(6);

    const { patch: p2 } = parsePatch({
      format: 'patchbay',
      modules: [{ id: 'osc1', type: 'osc', x: 0, y: 0 }],
      macros: [{ label: 'Bad', targets: [{ module: 'nope', param: 'tune', from: 0, to: 1 }] }],
    });
    expect(p2!.macros.length).toBe(0);
  });

  it('clamps tempo and defaults when missing/invalid', () => {
    expect(parsePatch({ format: 'patchbay', tempo: 9999 }).patch!.tempo).toBe(220);
    expect(parsePatch({ format: 'patchbay', tempo: -50 }).patch!.tempo).toBe(40);
    expect(parsePatch({ format: 'patchbay', tempo: 'NaN' }).patch!.tempo).toBe(110);
  });

  it('never throws across a battery of hostile inputs', () => {
    const hostile: unknown[] = [
      { toString() { throw new Error('nope'); } },
      { modules: [null, undefined, 1, 'x', [], { type: 'osc' }] },
      { cables: [null, undefined, 1, 'x', [], {}] },
      { macros: [null, undefined, 1, 'x', [], {}] },
      { view: 'not-an-object' },
      { view: { zoom: 'NaN', x: Infinity, y: -Infinity } },
      Symbol('x'),
      function () {},
      new Date(),
    ];
    for (const h of hostile) {
      expect(() => parsePatch(h)).not.toThrow();
    }
  });
});

describe('serializePatch', () => {
  it('produces pretty JSON that round-trips', () => {
    const patch: Patch = { format: 'patchbay', version: 1, name: 'Test', tempo: 100, modules: [], cables: [], macros: [] };
    const json = serializePatch(patch);
    expect(json).toContain('\n');
    expect(JSON.parse(json)).toEqual(patch);
  });
});
