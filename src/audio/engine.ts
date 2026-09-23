// TEMPORARY STUB — the real engine is being written by the lead. Implements EngineView with silence.
import type { EngineListener, EngineView } from './engineApi';
import type { PatchStore } from '../core/store';

export function createEngine(_store: PatchStore): EngineView {
  const listeners = new Set<EngineListener>();
  const e: EngineView = {
    started: false, playing: false, ctx: null, masterVolume: 0.5, heldNotes: [], recording: false, recordSeconds: 0,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async start() {}, play() {}, stop() {}, togglePlay() {}, panic() {}, setMasterVolume() {},
    noteOn() {}, noteOff() {}, allNotesOff() {}, setMod() {}, setBend() {},
    getLevel() { return 0; }, getProbeAnalyser() { return null; }, getMasterAnalyser() { return null; }, getCurrentStep() { return -1; },
    async startRecording() {}, async stopRecording() { return null; },
  };
  return e;
}
