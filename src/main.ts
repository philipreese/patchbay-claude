import './styles/tokens.css';
import './styles/base.css';
import { PatchStore } from './core/store';
import { createEngine } from './audio/engine';
import { PRESETS } from './presets';
import { buildShareUrl, decodePatchFromHash } from './core/share';
import { loadSession, saveSession } from './core/library';
import { parsePatch } from './core/serialize';
import { mountTopbar } from './ui/topbar';
import { mountOverlay } from './ui/overlay';
import { mountAmbience } from './ui/ambience';
import { toast } from './ui/toast';
import { attachComputerKeyboard } from './input/keyboard';
import { attachMidi } from './input/midi';
import type { Patch } from './core/types';

// ---- choose the starting patch: shared link > last session > the bass preset
let initial: Patch = PRESETS[0].make();
let initialNote: { msg: string; kind: 'info' | 'warn' } | null = null;
let fromLink = false;
const fromHash = decodePatchFromHash(location.hash);
if (fromHash) {
  if (fromHash.patch) {
    initial = fromHash.patch;
    fromLink = true;
    if (fromHash.warnings.length) initialNote = { msg: 'Shared patch loaded with fixes: ' + fromHash.warnings.slice(0, 2).join(' '), kind: 'warn' };
  } else {
    initialNote = { msg: `That share link couldn’t be read (${fromHash.error ?? 'damaged data'}). Loaded a starter instead.`, kind: 'warn' };
  }
  // The link has done its job; from now on the autosave holds the live state.
  history.replaceState(null, '', location.pathname + location.search);
} else {
  const session = loadSession();
  if (session) initial = session;
}

const store = new PatchStore(initial);
const engine = createEngine(store);

async function ensureStarted() {
  if (!engine.started || engine.ctx?.state !== 'running') await engine.start();
}

function loadPatch(input: Patch, opts: { autoplay?: boolean } = {}) {
  // Always re-validate: fills missing params, drops anything unsupported.
  const parsed = parsePatch(input);
  if (!parsed.patch) {
    toast(parsed.error || 'That patch could not be loaded.', 'warn');
    return;
  }
  const p = parsed.patch;
  const wasPlaying = engine.playing;
  engine.stop();
  engine.allNotesOff();
  store.load(p);
  const hasSeq = p.modules.some((m) => m.type === 'seq');
  if (engine.started && hasSeq && (opts.autoplay || wasPlaying)) setTimeout(() => engine.play(), 120);
  if (p.about) toast(p.about, 'info', 4200);
}

// ---- autosave (debounced)
let saveTimer: ReturnType<typeof setTimeout> | null = null;
store.subscribe((ev) => {
  if (ev.type === 'select' || ev.type === 'probe') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSession(store.patch), 600);
});
window.addEventListener('pagehide', () => saveSession(store.patch));

engine.on((ev) => {
  if (ev.type === 'error') toast(ev.message, 'warn', 5000);
});

mountTopbar(document.getElementById('topbar')!, { store, engine, loadPatch, ensureStarted });

attachComputerKeyboard(engine);
let midiAttached = false;
engine.on((ev) => {
  if (ev.type === 'started' && !midiAttached) {
    midiAttached = true;
    void attachMidi(engine, (s) => engine.emitMidi(s.status, s.inputs));
  }
});

// Nudge people who press keys on a patch that has nothing to play with.
let warnedNoKeys = false;
engine.on((ev) => {
  if (ev.type === 'notes' && ev.held.length && !engine.hasKeys() && !warnedNoKeys) {
    warnedNoKeys = true;
    toast('This patch has no Keys module — add one from “+ Add module” to play notes.', 'info', 4500);
  }
});

async function boot() {
  // Views load dynamically so a failure in one doesn't blank the app.
  try {
    const { mountCanvas } = await import('./ui/canvas');
    mountCanvas(document.getElementById('canvas-root')!, store, engine);
  } catch (e) {
    console.error('canvas failed', e);
  }
  try {
    mountAmbience(document.getElementById('canvas-root')!, engine);
  } catch (e) {
    console.error('ambience failed', e);
  }
  try {
    const { mountDock } = await import('./ui/dock');
    mountDock(document.getElementById('dock')!, document.getElementById('playbar')!, store, engine);
  } catch (e) {
    console.error('dock failed', e);
  }
  mountOverlay({
    store,
    engine,
    fromLink,
    async onStart() {
      await ensureStarted();
      if (store.patch.modules.some((m) => m.type === 'seq')) engine.play();
      if (initialNote) toast(initialNote.msg, initialNote.kind, 6000);
      else if (store.patch.about) toast(store.patch.about, 'info', 5000);
    },
  });
}
boot();

// iOS/Safari suspend audio when backgrounded; resume on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.started && engine.ctx?.state !== 'running') void engine.ctx?.resume();
});

// Test/debug handle (read-only use by the e2e suite).
(window as any).__patchbay = { store, engine, presets: PRESETS, loadPatch, shareUrl: () => buildShareUrl(store.patch) };
