import type { EngineView } from '../../audio/engineApi';
import { noteName } from '../../core/moduleDefs';
import type { Patch } from '../../core/types';

// Computer-key hint mapping, relative semitone offset from the current base octave.
const KEY_MAP: [string, number][] = [
  ['A', 0], ['W', 1], ['S', 2], ['E', 3], ['D', 4], ['F', 5], ['T', 6], ['G', 7],
  ['Y', 8], ['H', 9], ['U', 10], ['J', 11], ['K', 12], ['O', 13], ['L', 14], ['P', 15], [';', 16],
];

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_OFFSETS = [1, 3, 6, 8, 10];

const CHORDS: { name: string; notes: number[] }[] = [
  { name: 'C', notes: [48, 52, 55, 60] },
  { name: 'Dm', notes: [50, 53, 57, 62] },
  { name: 'Em', notes: [52, 55, 59, 64] },
  { name: 'F', notes: [53, 57, 60, 65] },
  { name: 'G', notes: [55, 59, 62, 67] },
  { name: 'Am', notes: [57, 60, 64, 69] },
  { name: 'Fmaj7', notes: [53, 57, 60, 64] },
  { name: 'G7', notes: [55, 59, 62, 65] },
];

export interface PlaybarWidgets {
  keyboardEl: HTMLElement;
  expressionEl: HTMLElement;
  chordsEl: HTMLElement;
  destroy(): void;
}

/** Builds the on-screen keyboard, expression strip and chord pads (single instances, reparentable). */
export function buildPlaybar(engine: EngineView, patch: Patch): PlaybarWidgets {
  let baseMidi = 60; // C4
  const heldFromEngine = new Set<number>();
  const locallyPressed = new Map<string, number>(); // gesture id -> note

  // ---- keyboard ----
  const keyboardRoot = document.createElement('div');
  keyboardRoot.className = 'pb-keyboard-root';
  const octaveBar = document.createElement('div');
  octaveBar.className = 'pb-octave-bar';
  const octMinus = document.createElement('button');
  octMinus.type = 'button';
  octMinus.className = 'pb-oct-btn';
  octMinus.textContent = '−';
  octMinus.setAttribute('aria-label', 'Octave down');
  const octLabel = document.createElement('div');
  octLabel.className = 'pb-oct-label';
  const octPlus = document.createElement('button');
  octPlus.type = 'button';
  octPlus.className = 'pb-oct-btn';
  octPlus.textContent = '+';
  octPlus.setAttribute('aria-label', 'Octave up');
  octaveBar.appendChild(octMinus);
  octaveBar.appendChild(octLabel);
  octaveBar.appendChild(octPlus);

  const keysScroll = document.createElement('div');
  keysScroll.className = 'pb-keys-scroll';
  const keysWrap = document.createElement('div');
  keysWrap.className = 'pb-keys';
  keysScroll.appendChild(keysWrap);

  keyboardRoot.appendChild(octaveBar);
  keyboardRoot.appendChild(keysScroll);

  let octaves = 2;
  const keyEls = new Map<number, HTMLElement>();

  function updateOctaveLabel() {
    octLabel.textContent = noteName(baseMidi);
  }

  function isDesktop() {
    return window.matchMedia('(min-width: 821px)').matches;
  }

  function renderKeys() {
    keysWrap.innerHTML = '';
    keyEls.clear();
    const totalSemis = octaves * 12;
    const whiteCount = octaves * 7 + 1;
    const whiteW = 100 / whiteCount;
    const showHints = isDesktop();
    const keyMapByOffset = new Map(KEY_MAP.map(([k, off]) => [off, k]));

    void totalSemis;
    // Build whites first (left to right), then blacks positioned on top.
    const whiteMidis: number[] = [];
    for (let o = 0; o <= octaves; o++) {
      for (const off of WHITE_OFFSETS) {
        const midi = baseMidi + o * 12 + off;
        if (o === octaves && off !== 0) continue; // stop at the octave's C
        whiteMidis.push(midi);
      }
    }
    whiteMidis.forEach((midi, i) => {
      const el = document.createElement('div');
      el.className = 'pb-key pb-key-white';
      el.dataset.midi = String(midi);
      el.style.left = i * whiteW + '%';
      el.style.width = whiteW + '%';
      const label = document.createElement('div');
      label.className = 'pb-key-hint';
      const offset = midi - baseMidi;
      const hint = keyMapByOffset.get(offset);
      if (showHints && hint) label.textContent = hint;
      el.appendChild(label);
      keysWrap.appendChild(el);
      keyEls.set(midi, el);
    });

    for (let o = 0; o < octaves; o++) {
      for (const off of BLACK_OFFSETS) {
        const midi = baseMidi + o * 12 + off;
        const whiteBefore = WHITE_OFFSETS.filter((w) => w < off).length + o * 7;
        const el = document.createElement('div');
        el.className = 'pb-key pb-key-black';
        el.dataset.midi = String(midi);
        el.style.left = (whiteBefore + 1) * whiteW - whiteW * 0.32 + '%';
        el.style.width = whiteW * 0.64 + '%';
        const label = document.createElement('div');
        label.className = 'pb-key-hint';
        const offset = midi - baseMidi;
        const hint = keyMapByOffset.get(offset);
        if (showHints && hint) label.textContent = hint;
        el.appendChild(label);
        keysWrap.appendChild(el);
        keyEls.set(midi, el);
      }
    }
    paintHeld();
  }

  function paintHeld() {
    keyEls.forEach((el, midi) => {
      const held = heldFromEngine.has(midi) || [...locallyPressed.values()].includes(midi);
      el.classList.toggle('is-held', held);
    });
  }

  function fitOctaves() {
    const w = keysScroll.clientWidth || 360;
    const n = w > 1500 ? 3 : w > 1000 ? 2 : 2;
    if (n !== octaves) {
      octaves = n;
      renderKeys();
    }
  }
  const ro = new ResizeObserver(() => fitOctaves());
  ro.observe(keysScroll);

  function velocityForKey(el: HTMLElement, clientY: number): number {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return 0.3 + frac * 0.7;
  }

  function keyAt(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const key = el.closest('.pb-key') as HTMLElement | null;
    return key && keysWrap.contains(key) ? key : null;
  }

  const pointerNote = new Map<number, number>(); // pointerId -> midi

  keysWrap.addEventListener('pointerdown', (e) => {
    const key = keyAt(e.clientX, e.clientY);
    if (!key) return;
    keysWrap.setPointerCapture(e.pointerId);
    const midi = Number(key.dataset.midi);
    const vel = velocityForKey(key, e.clientY);
    engine.noteOn(midi, vel);
    pointerNote.set(e.pointerId, midi);
    locallyPressed.set('p' + e.pointerId, midi);
    paintHeld();
    e.preventDefault();
  });
  keysWrap.addEventListener('pointermove', (e) => {
    if (!pointerNote.has(e.pointerId)) return;
    const key = keyAt(e.clientX, e.clientY);
    if (!key) return;
    const midi = Number(key.dataset.midi);
    const cur = pointerNote.get(e.pointerId);
    if (midi !== cur) {
      if (cur !== undefined) engine.noteOff(cur);
      const vel = velocityForKey(key, e.clientY);
      engine.noteOn(midi, vel);
      pointerNote.set(e.pointerId, midi);
      locallyPressed.set('p' + e.pointerId, midi);
      paintHeld();
    }
  });
  function releasePointer(e: PointerEvent) {
    const midi = pointerNote.get(e.pointerId);
    if (midi !== undefined) engine.noteOff(midi);
    pointerNote.delete(e.pointerId);
    locallyPressed.delete('p' + e.pointerId);
    paintHeld();
  }
  keysWrap.addEventListener('pointerup', releasePointer);
  keysWrap.addEventListener('pointercancel', releasePointer);
  keysWrap.addEventListener('lostpointercapture', releasePointer);

  function setOctave(midi: number, announce: boolean) {
    baseMidi = Math.min(96, Math.max(12, midi));
    updateOctaveLabel();
    renderKeys();
    if (announce) window.dispatchEvent(new CustomEvent('patchbay:octave', { detail: baseMidi }));
  }
  octMinus.addEventListener('click', () => setOctave(baseMidi - 12, true));
  octPlus.addEventListener('click', () => setOctave(baseMidi + 12, true));
  window.addEventListener('patchbay:octave', (e) => {
    const detail = (e as CustomEvent<number>).detail;
    if (typeof detail === 'number' && detail !== baseMidi) setOctave(detail, false);
  });

  const unsubEngine = engine.on((ev) => {
    if (ev.type === 'notes') {
      heldFromEngine.clear();
      for (const n of ev.held) heldFromEngine.add(n);
      paintHeld();
    }
  });

  updateOctaveLabel();
  renderKeys();

  // ---- expression strip ----
  const expressionEl = document.createElement('div');
  expressionEl.className = 'pb-expression';
  const expLabel = document.createElement('div');
  expLabel.className = 'pb-expression-label';
  expLabel.textContent = 'Expression';
  const expTrack = document.createElement('div');
  expTrack.className = 'pb-expression-track';
  const expFill = document.createElement('div');
  expFill.className = 'pb-expression-fill';
  const expVal = document.createElement('div');
  expVal.className = 'pb-expression-val';
  expVal.textContent = '0%';
  expTrack.appendChild(expFill);
  expTrack.appendChild(expVal);
  expressionEl.appendChild(expLabel);
  expressionEl.appendChild(expTrack);

  function setExpression(v: number) {
    v = Math.min(1, Math.max(0, v));
    expFill.style.height = v * 100 + '%';
    expVal.textContent = Math.round(v * 100) + '%';
    engine.setMod(v);
  }
  let expDragging = false;
  expTrack.addEventListener('pointerdown', (e) => {
    expDragging = true;
    expTrack.setPointerCapture(e.pointerId);
    expTrack.classList.add('is-dragging');
    const rect = expTrack.getBoundingClientRect();
    setExpression(1 - (e.clientY - rect.top) / rect.height);
  });
  expTrack.addEventListener('pointermove', (e) => {
    if (!expDragging) return;
    const rect = expTrack.getBoundingClientRect();
    setExpression(1 - (e.clientY - rect.top) / rect.height);
  });
  function releaseExpression(e: PointerEvent) {
    if (!expDragging) return;
    expDragging = false;
    expTrack.classList.remove('is-dragging');
    try {
      expTrack.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setExpression(0); // springs back to 0
  }
  expTrack.addEventListener('pointerup', releaseExpression);
  expTrack.addEventListener('pointercancel', releaseExpression);
  expTrack.addEventListener('lostpointercapture', releaseExpression);
  setExpression(0);

  // ---- chord pads ----
  const chordsEl = document.createElement('div');
  chordsEl.className = 'pb-chords' + (patch.chords ? ' is-primary' : ' is-secondary');
  const chordsLabel = document.createElement('div');
  chordsLabel.className = 'pb-chords-label';
  chordsLabel.textContent = 'Chords';
  const chordsRow = document.createElement('div');
  chordsRow.className = 'pb-chords-row';
  chordsEl.appendChild(chordsLabel);
  chordsEl.appendChild(chordsRow);

  const chordPointers = new Map<number, number[]>();
  for (const chord of CHORDS) {
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'pb-chord-pad';
    pad.textContent = chord.name;
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('is-active');
      for (const n of chord.notes) engine.noteOn(n, 0.85);
      chordPointers.set(e.pointerId, chord.notes);
      e.preventDefault();
    });
    function release(e: PointerEvent) {
      const notes = chordPointers.get(e.pointerId);
      if (!notes) return;
      for (const n of notes) engine.noteOff(n);
      chordPointers.delete(e.pointerId);
      pad.classList.remove('is-active');
      try {
        pad.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', release);
    chordsRow.appendChild(pad);
  }

  // ---- global "nothing sticks" safety net ----
  function releaseEverything() {
    for (const midi of pointerNote.values()) engine.noteOff(midi);
    pointerNote.clear();
    locallyPressed.clear();
    for (const notes of chordPointers.values()) for (const n of notes) engine.noteOff(n);
    chordPointers.clear();
    document.querySelectorAll('.pb-chord-pad.is-active').forEach((el) => el.classList.remove('is-active'));
    if (expDragging) {
      expDragging = false;
      setExpression(0);
    }
    paintHeld();
    engine.allNotesOff();
  }
  window.addEventListener('blur', releaseEverything);
  window.addEventListener('pointercancel', releaseEverything);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseEverything();
  });

  return {
    keyboardEl: keyboardRoot,
    expressionEl,
    chordsEl,
    destroy() {
      ro.disconnect();
      unsubEngine();
    },
  };
}
