import type { Cable, Macro, ModuleType, ParamValue, Patch, PatchModule, SeqStep } from '../core/types';
import { defaultParams } from '../core/moduleDefs';

// Starter patches. Built with small helpers so every module gets complete,
// valid params (defaults merged with overrides).

function mod(id: string, type: ModuleType, x: number, y: number, params: Record<string, ParamValue> = {}, label?: string): PatchModule {
  const m: PatchModule = { id, type, x, y, params: { ...defaultParams(type), ...params } };
  if (label) m.label = label;
  return m;
}

let cableN = 0;
function c(from: string, to: string, color: number): Cable {
  const [fm, fp] = from.split('.');
  const [tm, tp] = to.split('.');
  return { id: `c${++cableN}`, from: { module: fm, port: fp }, to: { module: tm, port: tp }, color };
}

function steps(pattern: string, notes: number[], accents = '', slides = ''): SeqStep[] {
  return Array.from({ length: 16 }, (_, i) => ({
    on: pattern[i] === 'x',
    note: notes[i] ?? 0,
    accent: accents[i] === 'x',
    slide: slides[i] === 'x',
  }));
}

function seq(id: string, x: number, y: number, params: Record<string, ParamValue>, st: SeqStep[], label?: string): PatchModule {
  const m = mod(id, 'seq', x, y, params, label);
  m.data = { steps: st };
  return m;
}

// Palette indices: 0 vermilion, 1 saffron, 2 cobalt, 3 jade, 4 magenta, 5 cyan
const AUDIO = 0, PITCH = 1, GATE = 4, MOD = 3, FX = 2, CV = 5;

export function bassPatch(): Patch {
  cableN = 0;
  const modules = [
    seq('seq1', 40, 40, { rate: '1/16', length: 16, gate: 0.45, root: 36, scale: 'minor', swing: 0.12 },
      steps('x.xxx.xx.xxx.xxx', [0, 0, 12, 0, 0, 3, 0, 0, 0, 7, 12, 10, 0, 3, 5, 7], 'x...x...x...x...', '..x.......x.....'), 'Bass line'),
    mod('keys1', 'keys', 40, 420, { voices: 1 }, 'Keys → transpose'),
    mod('osc1', 'osc', 520, 40, { wave: 'sawtooth', octave: 0, unison: 2, spread: 9 }),
    mod('osc2', 'osc', 520, 355, { wave: 'square', octave: -1, fine: -4 }, 'Sub'),
    mod('mix1', 'mixer', 780, 40, { level1: 0.8, level2: 0.55, level3: 0, level4: 0 }),
    mod('env1', 'env', 780, 356, { attack: 0.002, decay: 0.22, sustain: 0.05, release: 0.12, amount: 0.62, velocity: 0.6 }, 'Filter env'),
    mod('flt1', 'filter', 1080, 40, { mode: 'lowpass', cutoff: 180, res: 9, drive: 0.45 }),
    mod('env2', 'env', 1080, 318, { attack: 0.002, decay: 0.3, sustain: 0.55, release: 0.09, amount: 1, velocity: 0.4 }, 'Amp env'),
    mod('vca1', 'vca', 1380, 40, { gain: 0 }),
    mod('dly1', 'delay', 1380, 256, { sync: '1/8.', feedback: 0.32, tone: 2200, mix: 0.18 }),
    mod('out', 'output', 1660, 40, { level: 0.8 }),
  ];
  const cables = [
    c('seq1.pitch', 'osc1.pitch', PITCH),
    c('seq1.pitch', 'osc2.pitch', PITCH),
    c('seq1.gate', 'env1.gate', GATE),
    c('seq1.gate', 'env2.gate', GATE),
    c('keys1.gate', 'seq1.transpose', GATE),
    c('osc1.out', 'mix1.in1', AUDIO),
    c('osc2.out', 'mix1.in2', AUDIO),
    c('mix1.out', 'flt1.in', AUDIO),
    c('env1.out', 'flt1.cutoff', CV),
    c('flt1.out', 'vca1.in', AUDIO),
    c('env2.out', 'vca1.cv', CV),
    c('vca1.out', 'dly1.in', FX),
    c('dly1.out', 'out.in', FX),
  ];
  const macros: Macro[] = [
    { label: 'Brightness', hint: 'Filter cutoff', targets: [{ module: 'flt1', param: 'cutoff', from: 70, to: 2400 }] },
    { label: 'Squelch', hint: 'Resonance + envelope', targets: [{ module: 'flt1', param: 'res', from: 1, to: 20 }, { module: 'env1', param: 'amount', from: 0.25, to: 0.85 }] },
    { label: 'Length', hint: 'Note length', targets: [{ module: 'seq1', param: 'gate', from: 0.12, to: 0.95 }, { module: 'env1', param: 'decay', from: 0.08, to: 0.9 }] },
    { label: 'Echo', hint: 'Delay mix', targets: [{ module: 'dly1', param: 'mix', from: 0, to: 0.5 }, { module: 'dly1', param: 'feedback', from: 0.2, to: 0.6 }] },
  ];
  return {
    format: 'patchbay', version: 1, name: 'Night Drive Bass',
    about: 'Press play. Turn Brightness and Squelch. Hold a key to transpose the line.',
    tempo: 118, modules, cables, macros,
  };
}

export function padPatch(): Patch {
  cableN = 0;
  const modules = [
    mod('keys1', 'keys', 40, 40, { voices: 6, glide: 0 }),
    mod('osc1', 'osc', 340, 40, { wave: 'sawtooth', octave: 0, unison: 3, spread: 16 }),
    mod('osc2', 'osc', 340, 355, { wave: 'triangle', octave: 1, fine: 6 }, 'Air'),
    mod('mix1', 'mixer', 600, 40, { level1: 0.55, level2: 0.35, level3: 0, level4: 0 }),
    mod('flt1', 'filter', 900, 40, { mode: 'lowpass', cutoff: 1100, res: 1.6 }),
    mod('env1', 'env', 600, 356, { attack: 1.1, decay: 1.6, sustain: 0.8, release: 2.6, amount: 1, velocity: 0.3 }, 'Swell'),
    mod('env2', 'env', 40, 277, { attack: 1.6, decay: 2.5, sustain: 0.3, release: 3, amount: 0.35, velocity: 0.2 }, 'Filter bloom'),
    mod('lfo1', 'lfo', 900, 318, { wave: 'sine', rate: 0.13, depth: 0.18 }, 'Drift'),
    mod('vca1', 'vca', 1160, 40, { gain: 0 }),
    mod('rev1', 'reverb', 1160, 256, { size: 6.5, tone: 5200, mix: 0.45 }),
    mod('dly1', 'delay', 1400, 40, { sync: '1/4.', feedback: 0.35, tone: 2600, mix: 0.18 }),
    mod('out', 'output', 1400, 358, { level: 0.8 }),
  ];
  const cables = [
    c('keys1.pitch', 'osc1.pitch', PITCH),
    c('keys1.pitch', 'osc2.pitch', PITCH),
    c('keys1.gate', 'env1.gate', GATE),
    c('keys1.gate', 'env2.gate', GATE),
    c('osc1.out', 'mix1.in1', AUDIO),
    c('osc2.out', 'mix1.in2', AUDIO),
    c('mix1.out', 'flt1.in', AUDIO),
    c('env2.out', 'flt1.cutoff', CV),
    c('lfo1.out', 'flt1.cutoff', MOD),
    c('flt1.out', 'vca1.in', AUDIO),
    c('env1.out', 'vca1.cv', CV),
    c('vca1.out', 'rev1.in', FX),
    c('rev1.out', 'dly1.in', FX),
    c('dly1.out', 'out.in', FX),
  ];
  const macros: Macro[] = [
    { label: 'Brightness', hint: 'Filter cutoff', targets: [{ module: 'flt1', param: 'cutoff', from: 250, to: 6000 }] },
    { label: 'Swell', hint: 'Attack + release', targets: [{ module: 'env1', param: 'attack', from: 0.01, to: 3 }, { module: 'env1', param: 'release', from: 0.4, to: 6 }] },
    { label: 'Drift', hint: 'Slow filter movement', targets: [{ module: 'lfo1', param: 'depth', from: 0, to: 0.55 }] },
    { label: 'Space', hint: 'Reverb', targets: [{ module: 'rev1', param: 'mix', from: 0.05, to: 0.8 }, { module: 'rev1', param: 'size', from: 1.5, to: 11 }] },
  ];
  return {
    format: 'patchbay', version: 1, name: 'Glass Cathedral Pad',
    about: 'Hold chords — tap the chord pads or press several keys at once.',
    tempo: 90, modules, cables, macros, chords: true,
  };
}

export function leadPatch(): Patch {
  cableN = 0;
  const modules = [
    mod('keys1', 'keys', 40, 40, { voices: 1, glide: 0.09 }),
    mod('osc1', 'osc', 280, 40, { wave: 'sawtooth', unison: 2, spread: 7 }),
    mod('osc2', 'osc', 280, 355, { wave: 'square', tune: 12, fine: 5 }, 'Octave up'),
    mod('lfo1', 'lfo', 40, 277, { wave: 'sine', rate: 5.4, depth: 0.012 }, 'Vibrato'),
    mod('mix1', 'mixer', 540, 40, { level1: 0.7, level2: 0.3, level3: 0, level4: 0 }),
    mod('flt1', 'filter', 840, 40, { mode: 'lowpass', cutoff: 900, res: 5, drive: 0.35 }),
    mod('env1', 'env', 540, 356, { attack: 0.004, decay: 0.45, sustain: 0.35, release: 0.35, amount: 0.5, velocity: 0.7 }, 'Filter env'),
    mod('env2', 'env', 840, 318, { attack: 0.012, decay: 0.3, sustain: 0.85, release: 0.4, amount: 1, velocity: 0.5 }, 'Amp env'),
    mod('vca1', 'vca', 1140, 40, { gain: 0 }),
    mod('dly1', 'delay', 1140, 256, { sync: '1/8.', feedback: 0.42, tone: 3200, mix: 0.26 }),
    mod('rev1', 'reverb', 1420, 40, { size: 2.6, mix: 0.22 }),
    mod('out', 'output', 1420, 235, { level: 0.8 }),
  ];
  const cables = [
    c('keys1.pitch', 'osc1.pitch', PITCH),
    c('keys1.pitch', 'osc2.pitch', PITCH),
    c('lfo1.out', 'osc1.pitch', MOD),
    c('lfo1.out', 'osc2.pitch', MOD),
    c('keys1.pitch', 'flt1.track', PITCH),
    c('keys1.mod', 'flt1.cutoff', CV),
    c('keys1.gate', 'env1.gate', GATE),
    c('keys1.gate', 'env2.gate', GATE),
    c('osc1.out', 'mix1.in1', AUDIO),
    c('osc2.out', 'mix1.in2', AUDIO),
    c('mix1.out', 'flt1.in', AUDIO),
    c('env1.out', 'flt1.cutoff', CV),
    c('flt1.out', 'vca1.in', AUDIO),
    c('env2.out', 'vca1.cv', CV),
    c('vca1.out', 'dly1.in', FX),
    c('dly1.out', 'rev1.in', FX),
    c('rev1.out', 'out.in', FX),
  ];
  const macros: Macro[] = [
    { label: 'Brightness', hint: 'Filter cutoff', targets: [{ module: 'flt1', param: 'cutoff', from: 200, to: 5000 }] },
    { label: 'Vibrato', hint: 'Pitch wobble', targets: [{ module: 'lfo1', param: 'depth', from: 0, to: 0.05 }] },
    { label: 'Glide', hint: 'Slide between notes', targets: [{ module: 'keys1', param: 'glide', from: 0, to: 0.4 }] },
    { label: 'Echo', hint: 'Delay mix', targets: [{ module: 'dly1', param: 'mix', from: 0, to: 0.55 }] },
  ];
  return {
    format: 'patchbay', version: 1, name: 'Solar Lead',
    about: 'One note at a time. Hold one key and tap another to glide. Drag up on the expression strip.',
    tempo: 110, modules, cables, macros,
  };
}

export function ambientPatch(): Patch {
  cableN = 0;
  const modules = [
    seq('seq1', 40, 40, { rate: '1/8', length: 13, gate: 0.35, root: 60, scale: 'pentatonic', chance: 0.5, wander: 0.35 },
      steps('x.x.xx.x..x.x...', [0, 0, 7, 0, 9, 12, 0, 4, 0, 0, 14, 0, 7, 0, 0, 0]), 'Bells'),
    seq('seq2', 40, 420, { rate: '1/4', length: 7, gate: 0.9, root: 36, scale: 'pentatonic', chance: 0.8, wander: 0.2 },
      steps('x..x.x.', [0, 0, 0, 7, 0, -3, 0]), 'Low drone'),
    mod('keys1', 'keys', 780, 787, { voices: 1 }, 'Keys → transpose'),
    mod('osc1', 'osc', 520, 355, { wave: 'sine', octave: 0 }, 'Bell'),
    mod('osc3', 'osc', 520, 40, { wave: 'sine', octave: 1, tune: 7, fm: 0 }, 'Bell partial'),
    mod('env1', 'env', 780, 40, { attack: 0.004, decay: 2.2, sustain: 0, release: 2.5, amount: 1, velocity: 0.5 }, 'Bell env'),
    mod('vca1', 'vca', 780, 293, { gain: 0 }),
    mod('osc2', 'osc', 520, 670, { wave: 'triangle', octave: 1, unison: 2, spread: 10 }, 'Drone'),
    mod('flt2', 'filter', 780, 509, { mode: 'lowpass', cutoff: 520, res: 2 }),
    mod('env2', 'env', 1080, 40, { attack: 2.2, decay: 2, sustain: 0.7, release: 4, amount: 0.8, velocity: 0.2 }, 'Drone swell'),
    mod('vca2', 'vca', 1080, 293, { gain: 0 }),
    mod('noise1', 'noise', 1380, 40, { color: 'brown' }, 'Wind'),
    mod('lfo1', 'lfo', 1080, 509, { wave: 'sine', rate: 0.07, depth: 0.4 }, 'Gust'),
    mod('flt3', 'filter', 1380, 242, { mode: 'bandpass', cutoff: 700, res: 4 }),
    mod('mix1', 'mixer', 1380, 520, { level1: 0.55, level2: 0.5, level3: 0.18, level4: 0 }),
    mod('dly1', 'delay', 1640, 40, { sync: '1/4.', feedback: 0.58, tone: 2400, mix: 0.38 }),
    mod('rev1', 'reverb', 1640, 358, { size: 9, tone: 4200, mix: 0.6 }),
    mod('out', 'output', 1640, 553, { level: 0.8 }),
  ];
  const cables = [
    c('seq1.pitch', 'osc1.pitch', PITCH),
    c('seq1.pitch', 'osc3.pitch', PITCH),
    c('osc3.out', 'osc1.fm', CV),
    c('seq1.gate', 'env1.gate', GATE),
    c('osc1.out', 'vca1.in', AUDIO),
    c('env1.out', 'vca1.cv', CV),
    c('seq2.pitch', 'osc2.pitch', PITCH),
    c('seq2.gate', 'env2.gate', GATE),
    c('osc2.out', 'flt2.in', AUDIO),
    c('env2.out', 'flt2.cutoff', CV),
    c('flt2.out', 'vca2.in', AUDIO),
    c('env2.out', 'vca2.cv', CV),
    c('keys1.gate', 'seq1.transpose', GATE),
    c('keys1.gate', 'seq2.transpose', GATE),
    c('noise1.out', 'flt3.in', AUDIO),
    c('lfo1.out', 'flt3.cutoff', MOD),
    c('vca1.out', 'mix1.in1', AUDIO),
    c('vca2.out', 'mix1.in2', AUDIO),
    c('flt3.out', 'mix1.in3', AUDIO),
    c('mix1.out', 'dly1.in', FX),
    c('dly1.out', 'rev1.in', FX),
    c('rev1.out', 'out.in', FX),
  ];
  const macros: Macro[] = [
    { label: 'Density', hint: 'How many notes play', targets: [{ module: 'seq1', param: 'chance', from: 0.1, to: 1 }, { module: 'seq2', param: 'chance', from: 0.3, to: 1 }] },
    { label: 'Drift', hint: 'Melody wanders', targets: [{ module: 'seq1', param: 'wander', from: 0, to: 0.9 }] },
    { label: 'Shimmer', hint: 'Bell FM', targets: [{ module: 'osc1', param: 'fm', from: 0, to: 0.8 }] },
    { label: 'Wind', hint: 'Noise level', targets: [{ module: 'mix1', param: 'level3', from: 0, to: 0.6 }] },
  ];
  return {
    format: 'patchbay', version: 1, name: 'Tidepool (generative)',
    about: 'It plays itself. Nudge Density and Drift; press a key to move it to a new key.',
    tempo: 84, modules, cables, macros,
  };
}

export interface PresetEntry {
  id: string;
  name: string;
  tag: string;
  make: () => Patch;
}

export const PRESETS: PresetEntry[] = [
  { id: 'bass', name: 'Night Drive Bass', tag: 'Rhythmic bass', make: bassPatch },
  { id: 'pad', name: 'Glass Cathedral Pad', tag: 'Chord pad', make: padPatch },
  { id: 'lead', name: 'Solar Lead', tag: 'Expressive lead', make: leadPatch },
  { id: 'ambient', name: 'Tidepool', tag: 'Generative', make: ambientPatch },
];
