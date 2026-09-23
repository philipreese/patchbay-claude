import type { ModuleDef, ModuleType, ParamDef, ParamValue, NumberParamDef } from './types';

export const DELAY_SYNC = ['free', '1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2'];
export const SEQ_RATES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1'];
export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  'minor pent': [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const MODULE_DEFS: ModuleDef[] = [
  {
    type: 'keys',
    title: 'Keys',
    category: 'play',
    blurb: 'Your computer keyboard, the on-screen keys and MIDI. Sends pitch and note gates.',
    inputs: [],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'cv', hint: 'Pitch of each held note (1.0 per octave). Patch into an oscillator Pitch input.' },
      { id: 'gate', label: 'Gate', kind: 'gate', hint: 'Note on/off events. Patch into an envelope Gate.' },
      { id: 'mod', label: 'Mod', kind: 'cv', mono: true, hint: 'Expression strip / mod wheel, 0 to 1.' },
    ],
    params: [
      { key: 'voices', label: 'Voices', type: 'number', min: 1, max: 8, step: 1, default: 1, hint: 'How many notes can sound at once. 1 = mono (legato).' },
      { key: 'glide', label: 'Glide', type: 'number', min: 0, max: 1, default: 0, curve: 'lin', unit: 's', hint: 'Time to slide between notes.' },
      { key: 'octave', label: 'Octave', type: 'number', min: -3, max: 3, step: 1, default: 0, bipolar: true },
    ],
    polyCapable: false,
    width: 200,
  },
  {
    type: 'seq',
    title: 'Sequencer',
    category: 'play',
    blurb: '16-step note sequencer. Runs while the transport plays. Click steps to edit.',
    inputs: [{ id: 'transpose', label: 'Transp', kind: 'gate', hint: 'Notes played here transpose the sequence (relative to C).' }],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'cv', hint: 'Pitch of the current step (1.0 per octave).' },
      { id: 'gate', label: 'Gate', kind: 'gate', hint: 'Fires on each active step.' },
    ],
    params: [
      { key: 'rate', label: 'Rate', type: 'enum', options: SEQ_RATES, default: '1/16' },
      { key: 'length', label: 'Steps', type: 'number', min: 1, max: 16, step: 1, default: 16 },
      { key: 'gate', label: 'Gate', type: 'number', min: 0.05, max: 1, default: 0.5, hint: 'Note length as a fraction of a step.' },
      { key: 'swing', label: 'Swing', type: 'number', min: 0, max: 0.6, default: 0 },
      { key: 'root', label: 'Root', type: 'number', min: 24, max: 84, step: 1, default: 48, hint: 'Base note (MIDI).' },
      { key: 'scale', label: 'Scale', type: 'enum', options: Object.keys(SCALES), default: 'minor' },
      { key: 'chance', label: 'Chance', type: 'number', min: 0, max: 1, default: 1, hint: 'Probability each active step plays.' },
      { key: 'wander', label: 'Wander', type: 'number', min: 0, max: 1, default: 0, hint: 'Each loop, steps may drift to nearby notes in the scale.' },
    ],
    polyCapable: false,
    width: 440,
  },
  {
    type: 'osc',
    title: 'Oscillator',
    category: 'source',
    blurb: 'Makes a pitched tone. The shape sets its basic colour.',
    inputs: [
      { id: 'pitch', label: 'Pitch', kind: 'cv', hint: 'Pitch control, 1.0 per octave (from Keys or Sequencer).' },
      { id: 'fm', label: 'FM', kind: 'audio', hint: 'Frequency modulation. Audio here bends the pitch fast for metallic, bell-like tones.' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'The tone.' }],
    params: [
      { key: 'wave', label: 'Shape', type: 'enum', options: ['sine', 'triangle', 'sawtooth', 'square'], labels: ['Sine', 'Tri', 'Saw', 'Square'], default: 'sawtooth' },
      { key: 'octave', label: 'Octave', type: 'number', min: -3, max: 3, step: 1, default: 0, bipolar: true },
      { key: 'tune', label: 'Tune', type: 'number', min: -12, max: 12, step: 1, default: 0, unit: 'st', bipolar: true },
      { key: 'fine', label: 'Fine', type: 'number', min: -50, max: 50, default: 0, unit: 'ct', bipolar: true },
      { key: 'unison', label: 'Unison', type: 'number', min: 1, max: 4, step: 1, default: 1, hint: 'Stack detuned copies for a thicker sound.' },
      { key: 'spread', label: 'Spread', type: 'number', min: 0, max: 50, default: 12, unit: 'ct' },
      { key: 'fm', label: 'FM amt', type: 'number', min: 0, max: 1, default: 0.3 },
    ],
    polyCapable: true,
    width: 220,
  },
  {
    type: 'noise',
    title: 'Noise',
    category: 'source',
    blurb: 'Hiss and rumble. Great for percussion, wind and texture.',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Noise.' }],
    params: [{ key: 'color', label: 'Colour', type: 'enum', options: ['white', 'pink', 'brown'], labels: ['White', 'Pink', 'Brown'], default: 'pink' }],
    polyCapable: false,
    width: 140,
  },
  {
    type: 'filter',
    title: 'Filter',
    category: 'shape',
    blurb: 'Resonant filter. Cutoff makes the sound darker or brighter; resonance adds a singing peak.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio', hint: 'Sound to filter.' },
      { id: 'cutoff', label: 'Cutoff', kind: 'cv', hint: 'Moves the cutoff. 1.0 = four octaves up.' },
      { id: 'track', label: 'Track', kind: 'cv', hint: 'Key tracking: patch Pitch here so the cutoff follows the notes.' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Filtered sound.' }],
    params: [
      { key: 'mode', label: 'Mode', type: 'enum', options: ['lowpass', 'highpass', 'bandpass', 'notch'], labels: ['LP', 'HP', 'BP', 'Notch'], default: 'lowpass' },
      { key: 'cutoff', label: 'Cutoff', type: 'number', min: 30, max: 16000, default: 1200, curve: 'log', unit: 'Hz' },
      { key: 'res', label: 'Reso', type: 'number', min: 0.5, max: 22, default: 3, curve: 'log' },
      { key: 'drive', label: 'Drive', type: 'number', min: 0, max: 1, default: 0, hint: 'Saturation before the filter.' },
    ],
    polyCapable: true,
    width: 220,
  },
  {
    type: 'env',
    title: 'Envelope',
    category: 'modulate',
    blurb: 'Shapes each note over time: Attack, Decay, Sustain, Release.',
    inputs: [{ id: 'gate', label: 'Gate', kind: 'gate', hint: 'Note events that start and end the envelope.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'cv', hint: 'Envelope shape, 0 to Amount.' }],
    params: [
      { key: 'attack', label: 'Attack', type: 'number', min: 0.001, max: 6, default: 0.005, curve: 'log', unit: 's' },
      { key: 'decay', label: 'Decay', type: 'number', min: 0.01, max: 6, default: 0.3, curve: 'log', unit: 's' },
      { key: 'sustain', label: 'Sustain', type: 'number', min: 0, max: 1, default: 0.6 },
      { key: 'release', label: 'Release', type: 'number', min: 0.01, max: 10, default: 0.4, curve: 'log', unit: 's' },
      { key: 'amount', label: 'Amount', type: 'number', min: -1, max: 1, default: 1, bipolar: true },
      { key: 'velocity', label: 'Vel', type: 'number', min: 0, max: 1, default: 0.5, hint: 'How much harder notes open the envelope.' },
    ],
    polyCapable: true,
    width: 260,
  },
  {
    type: 'lfo',
    title: 'LFO',
    category: 'modulate',
    blurb: 'A slow wobble. Patch it into anything to make it move.',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'cv', hint: 'Wobble, ±Depth (or 0..Depth when unipolar).' }],
    params: [
      { key: 'wave', label: 'Shape', type: 'enum', options: ['sine', 'triangle', 'sawtooth', 'square', 'random'], labels: ['Sine', 'Tri', 'Saw', 'Square', 'Rand'], default: 'sine' },
      { key: 'rate', label: 'Rate', type: 'number', min: 0.02, max: 20, default: 1.5, curve: 'log', unit: 'Hz' },
      { key: 'depth', label: 'Depth', type: 'number', min: 0, max: 1, default: 0.3 },
      { key: 'polarity', label: 'Polarity', type: 'enum', options: ['bipolar', 'unipolar'], labels: ['±', '+'], default: 'bipolar' },
    ],
    polyCapable: false,
    width: 180,
  },
  {
    type: 'vca',
    title: 'Amp',
    category: 'shape',
    blurb: 'Volume control (VCA). Patch an envelope into CV to make notes start and stop.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio', hint: 'Sound in.' },
      { id: 'cv', label: 'CV', kind: 'cv', hint: 'Adds to the gain. An envelope here shapes each note.' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Sound out.' }],
    params: [{ key: 'gain', label: 'Gain', type: 'number', min: 0, max: 1, default: 0, hint: 'Base gain. Keep at 0 when an envelope controls CV.' }],
    polyCapable: true,
    width: 140,
  },
  {
    type: 'mixer',
    title: 'Mixer',
    category: 'shape',
    blurb: 'Blends up to four signals.',
    inputs: [
      { id: 'in1', label: '1', kind: 'audio', hint: 'Input 1' },
      { id: 'in2', label: '2', kind: 'audio', hint: 'Input 2' },
      { id: 'in3', label: '3', kind: 'audio', hint: 'Input 3' },
      { id: 'in4', label: '4', kind: 'audio', hint: 'Input 4' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Mix of all inputs.' }],
    params: [
      { key: 'level1', label: 'Lvl 1', type: 'number', min: 0, max: 1, default: 0.7 },
      { key: 'level2', label: 'Lvl 2', type: 'number', min: 0, max: 1, default: 0.7 },
      { key: 'level3', label: 'Lvl 3', type: 'number', min: 0, max: 1, default: 0.7 },
      { key: 'level4', label: 'Lvl 4', type: 'number', min: 0, max: 1, default: 0.7 },
    ],
    polyCapable: true,
    width: 220,
  },
  {
    type: 'delay',
    title: 'Delay',
    category: 'effect',
    blurb: 'Echoes that bounce left and right.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio', hint: 'Sound in.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Dry sound plus echoes (stereo).' }],
    params: [
      { key: 'sync', label: 'Sync', type: 'enum', options: DELAY_SYNC, default: '1/8.' },
      { key: 'time', label: 'Time', type: 'number', min: 0.02, max: 1.5, default: 0.35, curve: 'log', unit: 's', hint: 'Used when Sync is free.' },
      { key: 'feedback', label: 'Repeats', type: 'number', min: 0, max: 0.92, default: 0.4 },
      { key: 'tone', label: 'Tone', type: 'number', min: 400, max: 12000, default: 3500, curve: 'log', unit: 'Hz' },
      { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, default: 0.3 },
    ],
    polyCapable: false,
    width: 240,
  },
  {
    type: 'reverb',
    title: 'Reverb',
    category: 'effect',
    blurb: 'Puts the sound in a room, hall or cavern.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio', hint: 'Sound in.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio', hint: 'Dry sound plus reverb (stereo).' }],
    params: [
      { key: 'size', label: 'Size', type: 'number', min: 0.4, max: 12, default: 3, curve: 'log', unit: 's', hint: 'Decay time.' },
      { key: 'tone', label: 'Tone', type: 'number', min: 800, max: 14000, default: 6000, curve: 'log', unit: 'Hz' },
      { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, default: 0.3 },
    ],
    polyCapable: false,
    width: 200,
  },
  {
    type: 'output',
    title: 'Output',
    category: 'out',
    blurb: 'Your speakers. Anything patched here is heard (and recorded).',
    inputs: [{ id: 'in', label: 'In', kind: 'audio', hint: 'Sound to hear.' }],
    outputs: [],
    params: [{ key: 'level', label: 'Level', type: 'number', min: 0, max: 1, default: 0.8 }],
    polyCapable: false,
    width: 140,
    singleton: true,
  },
];

const BY_TYPE = new Map<ModuleType, ModuleDef>(MODULE_DEFS.map((d) => [d.type, d]));

export function allModuleDefs(): ModuleDef[] {
  return MODULE_DEFS;
}

export function getModuleDef(type: string): ModuleDef | undefined {
  return BY_TYPE.get(type as ModuleType);
}

export function isModuleType(type: unknown): type is ModuleType {
  return typeof type === 'string' && BY_TYPE.has(type as ModuleType);
}

export function getParamDef(type: string, key: string): ParamDef | undefined {
  return getModuleDef(type)?.params.find((p) => p.key === key);
}

export function defaultParams(type: ModuleType): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of BY_TYPE.get(type)!.params) out[p.key] = p.default;
  return out;
}

/** Clamp/validate a param value; returns the default for garbage. */
export function sanitizeParam(def: ParamDef, value: unknown): ParamValue {
  if (def.type === 'enum') {
    return typeof value === 'string' && def.options.includes(value) ? value : def.default;
  }
  let v = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(v)) return def.default;
  v = Math.min(def.max, Math.max(def.min, v));
  if (def.step) v = Math.round(v / def.step) * def.step;
  return v;
}

/** Map a param value to knob position 0..1 (respects log curves). */
export function paramToNorm(def: NumberParamDef, v: number): number {
  if (def.curve === 'log' && def.min > 0) {
    return Math.log(v / def.min) / Math.log(def.max / def.min);
  }
  return (v - def.min) / (def.max - def.min);
}

/** Map knob position 0..1 to a param value (respects log curves and steps). */
export function normToParam(def: NumberParamDef, n: number): number {
  n = Math.min(1, Math.max(0, n));
  let v = def.curve === 'log' && def.min > 0 ? def.min * Math.pow(def.max / def.min, n) : def.min + n * (def.max - def.min);
  if (def.step) v = Math.round(v / def.step) * def.step;
  return v;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function noteName(midi: number): string {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/** Human-readable value for a param (used by knobs and tooltips). */
export function formatParam(def: ParamDef, v: ParamValue): string {
  if (def.type === 'enum') {
    const i = def.options.indexOf(v as string);
    return def.labels?.[i] ?? String(v);
  }
  const n = v as number;
  if (def.key === 'root') return noteName(n);
  if (def.unit === 'Hz') return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 1 : 2) + 'k' : n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2);
  if (def.unit === 's') return n < 1 ? Math.round(n * 1000) + 'ms' : n.toFixed(2) + 's';
  if (def.step === 1) return (def.bipolar && n > 0 ? '+' : '') + n.toFixed(0) + (def.unit ?? '');
  if (def.unit) return (def.bipolar && n > 0 ? '+' : '') + n.toFixed(0) + def.unit;
  // unitless 0..1-ish values display as percentages
  if (def.max <= 1 && def.min >= -1) return (def.bipolar && n > 0 ? '+' : '') + Math.round(n * 100) + '%';
  return n.toFixed(1);
}
