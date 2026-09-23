import type { EngineView } from '../audio/engineApi';

// Relative to the current base note. Uses KeyboardEvent.code where practical so
// the layout stays put on non-US keyboards (physical key position, not the
// character it produces).
const CODE_TO_OFFSET: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

// Fallback by `key` for browsers/layouts where `code` is unavailable.
const KEY_TO_OFFSET: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
  "'": 17,
};

const MIN_BASE = 24;
const MAX_BASE = 96;
const DEFAULT_BASE = 60;

export interface KeyboardHandle {
  getBase(): number;
  setBase(midi: number): void;
  detach(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function attachComputerKeyboard(engine: EngineView): KeyboardHandle {
  let base = DEFAULT_BASE;
  // Which physical keys are currently held, and which MIDI note they triggered
  // (so an octave change mid-hold still releases the correct note).
  const pressed = new Map<string, number>();

  function offsetFor(e: KeyboardEvent): number | undefined {
    if (e.code && CODE_TO_OFFSET[e.code] !== undefined) return CODE_TO_OFFSET[e.code];
    const k = e.key?.length === 1 ? e.key.toLowerCase() : e.key;
    return KEY_TO_OFFSET[k];
  }

  function releaseAll() {
    for (const note of pressed.values()) engine.noteOff(note);
    pressed.clear();
  }

  function setBase(midi: number) {
    const clamped = Math.min(MAX_BASE, Math.max(MIN_BASE, Math.round(midi)));
    if (clamped === base) return;
    base = clamped;
    try {
      window.dispatchEvent(new CustomEvent('patchbay:octave', { detail: base }));
    } catch {
      /* ignore */
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      engine.togglePlay();
      return;
    }
    if (e.code === 'Escape' || e.key === 'Escape') {
      engine.panic();
      releaseAll();
      return;
    }
    if (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z') {
      setBase(base - 12);
      return;
    }
    if (e.code === 'KeyX' || e.key === 'x' || e.key === 'X') {
      setBase(base + 12);
      return;
    }
    const offset = offsetFor(e);
    if (offset === undefined) return;
    const keyId = e.code || e.key;
    if (pressed.has(keyId)) return;
    const note = base + offset;
    pressed.set(keyId, note);
    engine.noteOn(note, 0.9);
  }

  function onKeyUp(e: KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    const keyId = e.code || e.key;
    const note = pressed.get(keyId);
    if (note === undefined) return;
    pressed.delete(keyId);
    engine.noteOff(note);
  }

  function onBlur() {
    releaseAll();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') releaseAll();
  }

  function onExternalOctave(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (typeof detail === 'number' && Number.isFinite(detail)) {
      const clamped = Math.min(MAX_BASE, Math.max(MIN_BASE, Math.round(detail)));
      base = clamped;
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('patchbay:octave', onExternalOctave as EventListener);

  return {
    getBase() {
      return base;
    },
    setBase(midi: number) {
      setBase(midi);
    },
    detach() {
      releaseAll();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('patchbay:octave', onExternalOctave as EventListener);
    },
  };
}
