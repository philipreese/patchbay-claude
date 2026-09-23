// Shared data model for Patchbay. Everything that is saved, shared, or synced
// between the UI and the audio engine is described here.

export type ModuleType =
  | 'keys'
  | 'seq'
  | 'osc'
  | 'noise'
  | 'filter'
  | 'env'
  | 'lfo'
  | 'vca'
  | 'mixer'
  | 'delay'
  | 'reverb'
  | 'output';

/**
 * Port kinds:
 *  - 'audio': audio-rate sound signal (-1..1)
 *  - 'cv':    audio-rate control signal (modulation, pitch). Audio and CV are
 *             electrically identical and may be patched into each other.
 *  - 'gate':  note events (on/off with pitch + velocity). Not audio. Gate
 *             outputs may only connect to gate inputs.
 */
export type PortKind = 'audio' | 'cv' | 'gate';

export interface PortDef {
  id: string;
  label: string;
  kind: PortKind;
  /** Short plain-English description shown in tooltips. */
  hint: string;
  /** Output ports only: this port is always monophonic even on a poly module. */
  mono?: boolean;
}

export interface NumberParamDef {
  key: string;
  label: string;
  type: 'number';
  min: number;
  max: number;
  default: number;
  /** 'log' for frequencies/times: knob travel is exponential. */
  curve?: 'lin' | 'log';
  /** Integer steps when set (e.g. 1). */
  step?: number;
  unit?: string;
  /** Bipolar params draw their arc from the centre. */
  bipolar?: boolean;
  hint?: string;
}

export interface EnumParamDef {
  key: string;
  label: string;
  type: 'enum';
  options: string[];
  /** Optional display labels for options (same order). */
  labels?: string[];
  default: string;
  hint?: string;
}

export type ParamDef = NumberParamDef | EnumParamDef;
export type ParamValue = number | string;

export interface ModuleDef {
  type: ModuleType;
  title: string;
  /** Category controls colour + grouping in the add-module menu. */
  category: 'play' | 'source' | 'shape' | 'modulate' | 'effect' | 'out';
  blurb: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** Can this module run one copy per voice when fed by a polyphonic source? */
  polyCapable: boolean;
  /** Width in canvas units (height is derived by the UI). */
  width: number;
  /** At most one allowed / cannot be deleted (output). */
  singleton?: boolean;
}

export interface SeqStep {
  /** Step plays a note. */
  on: boolean;
  /** Semitone offset from the sequencer root, -24..24. */
  note: number;
  /** Accented steps play louder (velocity 1 instead of 0.72). */
  accent: boolean;
  /** Slide: pitch glides into the next step and the gate is held (legato). */
  slide: boolean;
}

export interface SeqData {
  steps: SeqStep[]; // always 16 entries; `length` param picks how many play
}

export interface PatchModule {
  id: string;
  type: ModuleType;
  x: number;
  y: number;
  /** Optional user label; defaults to the module title. */
  label?: string;
  params: Record<string, ParamValue>;
  data?: SeqData;
}

export interface PortRef {
  module: string;
  port: string;
}

export interface Cable {
  id: string;
  from: PortRef; // output port
  to: PortRef; // input port
  /** Colour index into the cable palette (UI only). */
  color?: number;
}

export interface MacroTarget {
  module: string;
  param: string;
  /** Param value when the macro is at 0 and at 1. */
  from: number;
  to: number;
}

/** A beginner-friendly performance knob that drives one or more module params. */
export interface Macro {
  label: string;
  hint?: string;
  targets: MacroTarget[];
}

export interface Patch {
  format: 'patchbay';
  version: 1;
  name: string;
  /** Short description of how to play it, shown to newcomers. */
  about?: string;
  tempo: number; // BPM 40..220
  modules: PatchModule[];
  cables: Cable[];
  macros: Macro[];
  /** Optional canvas view so a shared patch opens framed the same way. */
  view?: { x: number; y: number; zoom: number };
  /** Hint for the play surface: show chord pads when true. */
  chords?: boolean;
}

export interface GateEvent {
  type: 'on' | 'off';
  /** Voice index on the sending module. */
  voice: number;
  /** MIDI note number (60 = middle C). */
  note: number;
  velocity: number; // 0..1
  /** AudioContext time the event takes effect. */
  time: number;
  /** When true, pitch should glide and envelopes should not retrigger. */
  legato?: boolean;
}

export type ConnectResult = { ok: true; cable: Cable } | { ok: false; reason: string };
