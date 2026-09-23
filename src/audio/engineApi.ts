import type { GateEvent, PortRef } from '../core/types';

/**
 * Read/drive surface of the audio engine used by the UI.
 * Every getter reflects real audio state; before `start()` (no AudioContext)
 * levels are 0 and analysers are null.
 */
export type EngineEvent =
  | { type: 'started' } // AudioContext running
  | { type: 'transport'; playing: boolean }
  | { type: 'gate'; module: string; port: string; ev: GateEvent } // a gate output fired (UI can flash cables)
  | { type: 'step'; module: string; step: number; time: number } // sequencer step scheduled at ctx time `time`
  | { type: 'notes'; held: number[] } // MIDI notes currently held on Keys (for key highlighting)
  | { type: 'volume'; value: number }
  | { type: 'midi'; status: 'unsupported' | 'denied' | 'ready'; inputs: string[] }
  | { type: 'error'; message: string };

export type EngineListener = (ev: EngineEvent) => void;

export interface EngineView {
  readonly started: boolean;
  readonly playing: boolean;
  readonly ctx: AudioContext | null;
  readonly masterVolume: number; // 0..1

  on(fn: EngineListener): () => void;

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  start(): Promise<void>;
  /** Transport (sequencers). */
  play(): void;
  stop(): void;
  togglePlay(): void;
  /** Stop everything immediately: transport, notes, echo/reverb tails. */
  panic(): void;
  setMasterVolume(v: number): void;

  /** Performance input. `note` is a MIDI note number; velocity 0..1. */
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
  /** Expression (Keys "Mod" output), 0..1. */
  setMod(v: number): void;
  /** Pitch bend in semitones (-2..2 typical). */
  setBend(semitones: number): void;
  readonly heldNotes: number[];

  /** Smoothed signal level of an output port, 0..~1. Gate ports: recent activity 0..1. */
  getLevel(ref: PortRef): number;
  /** Analyser for the currently probed port (store.probe), or the master bus. */
  getProbeAnalyser(): AnalyserNode | null;
  /** Analyser on the master bus (after master volume). */
  getMasterAnalyser(): AnalyserNode | null;
  /** Step index currently sounding for a sequencer, or -1 when stopped. */
  getCurrentStep(seqId: string): number;

  /** Record the master output. stopRecording resolves with a WAV blob. */
  startRecording(): Promise<void>;
  stopRecording(): Promise<Blob | null>;
  readonly recording: boolean;
  /** Seconds recorded so far. */
  readonly recordSeconds: number;
}
