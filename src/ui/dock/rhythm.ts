import type { PatchStore } from '../../core/store';
import type { EngineView } from '../../audio/engineApi';
import type { PatchModule, SeqData } from '../../core/types';
import { SCALES, SEQ_RATES, getModuleDef, noteName } from '../../core/moduleDefs';

function snapToScale(raw: number, scaleName: string): number {
  const scale = SCALES[scaleName] ?? SCALES.chromatic;
  let best = 0;
  let bestDist = Infinity;
  for (let oct = -3; oct <= 3; oct++) {
    for (const deg of scale) {
      const candidate = oct * 12 + deg;
      if (candidate < -24 || candidate > 24) continue;
      const d = Math.abs(candidate - raw);
      if (d < bestDist) {
        bestDist = d;
        best = candidate;
      }
    }
  }
  return best;
}

function scaleCandidates(scaleName: string): number[] {
  const sc = SCALES[scaleName] ?? SCALES.chromatic;
  const out: number[] = [];
  for (let oct = -3; oct <= 3; oct++) for (const deg of sc) out.push(oct * 12 + deg);
  return out.sort((a, b) => a - b);
}

function cloneData(d: SeqData): SeqData {
  return { steps: d.steps.map((s) => ({ ...s })) };
}

/** Comfortable 16-step editor for a `seq` module, with a chip selector when several exist. */
export function mountRhythm(container: HTMLElement, store: PatchStore, engine: EngineView): { destroy(): void; hasSeq(): boolean } {
  container.innerHTML = '';
  container.className = 'dock-rhythm';

  const chipRow = document.createElement('div');
  chipRow.className = 'rhythm-chips';
  const body = document.createElement('div');
  body.className = 'rhythm-body';
  container.appendChild(chipRow);
  container.appendChild(body);

  let selected: string | null = null;
  let cellEls: HTMLElement[] = [];
  let noteEls: HTMLElement[] = [];
  let colEls: HTMLElement[] = [];
  let upBtns: HTMLButtonElement[] = [];
  let downBtns: HTMLButtonElement[] = [];
  let accentBtns: HTMLButtonElement[] = [];
  let slideBtns: HTMLButtonElement[] = [];
  let playhead = -1;
  // Set right before a store mutation this module triggers itself, so the
  // subscribe callback below can skip a redundant/destructive rebuild — the
  // triggering handler already applies the matching visual update directly.
  let suppress = false;

  function seqList(): PatchModule[] {
    return store.patch.modules.filter((m) => m.type === 'seq');
  }

  function pickSelected() {
    const list = seqList();
    if (!list.length) {
      selected = null;
      return;
    }
    if (!selected || !list.some((m) => m.id === selected)) selected = list[0].id;
  }

  function buildChips() {
    const list = seqList();
    chipRow.innerHTML = '';
    chipRow.style.display = list.length > 1 ? '' : 'none';
    for (const m of list) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rhythm-chip' + (m.id === selected ? ' is-active' : '');
      chip.textContent = m.label ?? getModuleDef(m.type)?.title ?? m.id;
      chip.addEventListener('click', () => {
        selected = m.id;
        rebuild();
      });
      chipRow.appendChild(chip);
    }
  }

  function controlRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'rhythm-controls';
    return row;
  }

  function paintCell(i: number, mod: PatchModule) {
    const s = mod.data?.steps[i];
    if (!s) return;
    const cell = cellEls[i];
    const noteLabel = noteEls[i];
    const root = (mod.params.root as number) ?? 48;
    cell.classList.toggle('is-on', s.on);
    cell.classList.toggle('is-accent', s.accent);
    cell.classList.toggle('is-slide', s.slide);
    accentBtns[i]?.classList.toggle('is-active', s.accent);
    slideBtns[i]?.classList.toggle('is-active', s.slide);
    noteLabel.textContent = s.on ? noteName(root + s.note) : '·';
  }

  function paintAll(mod: PatchModule) {
    mod.data?.steps.forEach((_, i) => paintCell(i, mod));
  }

  function applyLength(length: number) {
    colEls.forEach((col, i) => {
      const active = i < length;
      col.classList.toggle('is-inactive', !active);
      if (upBtns[i]) upBtns[i].disabled = !active;
      if (downBtns[i]) downBtns[i].disabled = !active;
    });
  }

  function mutateData(mod: PatchModule, fn: (clone: SeqData) => void) {
    const clone = cloneData(mod.data ?? { steps: Array.from({ length: 16 }, () => ({ on: false, note: 0, accent: false, slide: false })) });
    fn(clone);
    suppress = true;
    store.setData(mod.id, clone);
    paintAll({ ...mod, data: clone });
  }

  function rebuild() {
    pickSelected();
    buildChips();
    body.innerHTML = '';
    cellEls = [];
    noteEls = [];
    colEls = [];
    upBtns = [];
    downBtns = [];
    accentBtns = [];
    slideBtns = [];
    if (!selected) {
      const empty = document.createElement('div');
      empty.className = 'rhythm-empty';
      empty.textContent = 'No sequencer in this patch.';
      body.appendChild(empty);
      return;
    }
    const mod = store.getModule(selected)!;
    if (!mod.data) mod.data = { steps: Array.from({ length: 16 }, () => ({ on: false, note: 0, accent: false, slide: false })) };
    const length = (mod.params.length as number) ?? 16;

    // Tempo
    const tempoRow = document.createElement('div');
    tempoRow.className = 'rhythm-tempo';
    const tempoLabel = document.createElement('div');
    tempoLabel.className = 'rhythm-tempo-label';
    tempoLabel.textContent = 'Tempo';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'rhythm-step-btn';
    minus.textContent = '−';
    const bpmEl = document.createElement('div');
    bpmEl.className = 'rhythm-bpm';
    bpmEl.textContent = store.patch.tempo + ' BPM';
    bpmEl.tabIndex = 0;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'rhythm-step-btn';
    plus.textContent = '+';
    minus.addEventListener('click', () => store.setTempo(store.patch.tempo - 1));
    plus.addEventListener('click', () => store.setTempo(store.patch.tempo + 1));
    let dragTempoStart = 0;
    let dragTempoVal = 0;
    let draggingTempo = false;
    bpmEl.addEventListener('pointerdown', (e) => {
      draggingTempo = true;
      dragTempoStart = e.clientY;
      dragTempoVal = store.patch.tempo;
      bpmEl.setPointerCapture(e.pointerId);
    });
    bpmEl.addEventListener('pointermove', (e) => {
      if (!draggingTempo) return;
      const dy = dragTempoStart - e.clientY;
      store.setTempo(Math.round(dragTempoVal + dy * 0.5));
    });
    bpmEl.addEventListener('pointerup', (e) => {
      draggingTempo = false;
      try {
        bpmEl.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    tempoRow.appendChild(tempoLabel);
    tempoRow.appendChild(minus);
    tempoRow.appendChild(bpmEl);
    tempoRow.appendChild(plus);
    body.appendChild(tempoRow);

    // Rate chips
    const rateRow = controlRow();
    const rateLabel = document.createElement('div');
    rateLabel.className = 'rhythm-control-label';
    rateLabel.textContent = 'Rate';
    rateRow.appendChild(rateLabel);
    const rateChips = document.createElement('div');
    rateChips.className = 'rhythm-rate-chips';
    for (const r of SEQ_RATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rhythm-chip small' + (mod.params.rate === r ? ' is-active' : '');
      b.textContent = r;
      b.addEventListener('click', () => {
        suppress = true;
        store.setParam(mod.id, 'rate', r);
        rateChips.querySelectorAll('.rhythm-chip').forEach((c) => c.classList.remove('is-active'));
        b.classList.add('is-active');
      });
      rateChips.appendChild(b);
    }
    rateRow.appendChild(rateChips);
    body.appendChild(rateRow);

    // Steps / Gate / Swing sliders
    body.appendChild(
      makeSlider('Steps', mod.params.length as number, 1, 16, 1, (v) => {
        suppress = true;
        store.setParam(mod.id, 'length', v);
        applyLength(v);
      }),
    );
    body.appendChild(
      makeSlider('Gate', mod.params.gate as number, 0.05, 1, 0.01, (v) => {
        suppress = true;
        store.setParam(mod.id, 'gate', v);
      }),
    );
    body.appendChild(
      makeSlider('Swing', mod.params.swing as number, 0, 0.6, 0.01, (v) => {
        suppress = true;
        store.setParam(mod.id, 'swing', v);
      }),
    );

    // Step grid
    const grid = document.createElement('div');
    grid.className = 'rhythm-grid';
    mod.data.steps.forEach((_step, i) => {
      const col = document.createElement('div');
      col.className = 'rhythm-col' + (i < length ? '' : ' is-inactive');

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'rhythm-note-btn';
      up.textContent = '▲';
      up.disabled = i >= length;
      up.addEventListener('click', () => changeNote(i, 1));

      const noteLabel = document.createElement('div');
      noteLabel.className = 'rhythm-note-label';

      const cell = document.createElement('div');
      cell.className = 'rhythm-cell';
      cell.dataset.index = String(i);

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'rhythm-note-btn';
      down.textContent = '▼';
      down.disabled = i >= length;
      down.addEventListener('click', () => changeNote(i, -1));

      const toggles = document.createElement('div');
      toggles.className = 'rhythm-toggles';
      const accentBtn = document.createElement('button');
      accentBtn.type = 'button';
      accentBtn.className = 'rhythm-tiny-toggle';
      accentBtn.textContent = 'A';
      accentBtn.title = 'Accent';
      const slideBtn = document.createElement('button');
      slideBtn.type = 'button';
      slideBtn.className = 'rhythm-tiny-toggle';
      slideBtn.textContent = 'S';
      slideBtn.title = 'Slide';
      toggles.appendChild(accentBtn);
      toggles.appendChild(slideBtn);

      col.appendChild(up);
      col.appendChild(noteLabel);
      col.appendChild(cell);
      col.appendChild(down);
      col.appendChild(toggles);
      grid.appendChild(col);
      cellEls.push(cell);
      noteEls.push(noteLabel);
      colEls.push(col);
      upBtns.push(up);
      downBtns.push(down);
      accentBtns.push(accentBtn);
      slideBtns.push(slideBtn);

      paintCell(i, mod);

      if (i >= length) return; // beyond `length`: shown dimmed, not interactive

      let downAt = 0;
      let downY = 0;
      let moved = false;
      cell.addEventListener('pointerdown', (e) => {
        downAt = performance.now();
        downY = e.clientY;
        moved = false;
        cell.setPointerCapture(e.pointerId);
      });
      cell.addEventListener('pointermove', (e) => {
        if (Math.abs(downY - e.clientY) > 6) moved = true;
      });
      cell.addEventListener('pointerup', (e) => {
        try {
          cell.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const dy = downY - e.clientY;
        const isTap = !moved && Math.abs(dy) < 6 && performance.now() - downAt < 600;
        const m = store.getModule(mod.id)!;
        mutateData(m, (clone) => {
          const s = clone.steps[i];
          if (isTap) {
            s.on = !s.on;
          } else if (Math.abs(dy) >= 6 && s.on) {
            const raw = Math.max(-24, Math.min(24, s.note + Math.round(dy / 8)));
            s.note = snapToScale(raw, (m.params.scale as string) ?? 'minor');
          }
        });
      });

      accentBtn.addEventListener('click', () => {
        const m = store.getModule(mod.id)!;
        mutateData(m, (clone) => {
          clone.steps[i].accent = !clone.steps[i].accent;
        });
      });
      slideBtn.addEventListener('click', () => {
        const m = store.getModule(mod.id)!;
        mutateData(m, (clone) => {
          clone.steps[i].slide = !clone.steps[i].slide;
        });
      });

      function changeNote(idx: number, dir: 1 | -1) {
        const m = store.getModule(mod.id)!;
        mutateData(m, (clone) => {
          const s = clone.steps[idx];
          if (!s.on) s.on = true;
          const candidates = scaleCandidates((m.params.scale as string) ?? 'minor');
          let pos = candidates.findIndex((c) => c >= s.note);
          if (pos < 0) pos = candidates.length - 1;
          if (dir > 0) pos = s.note < candidates[pos] ? pos : Math.min(candidates.length - 1, pos + 1);
          else pos = s.note > candidates[Math.max(0, pos - 1)] ? Math.max(0, pos - 1) : Math.max(0, pos - 2);
          s.note = Math.max(-24, Math.min(24, candidates[Math.max(0, Math.min(candidates.length - 1, pos))]));
        });
      }
    });
    body.appendChild(grid);
  }

  function makeSlider(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void): HTMLElement {
    const row = controlRow();
    const l = document.createElement('div');
    l.className = 'rhythm-control-label';
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'rhythm-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const val = document.createElement('div');
    val.className = 'rhythm-control-val';
    val.textContent = step >= 1 ? String(Math.round(value)) : value.toFixed(2);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = step >= 1 ? String(Math.round(v)) : v.toFixed(2);
      onInput(v);
    });
    row.appendChild(l);
    row.appendChild(input);
    row.appendChild(val);
    row.dataset.control = label;
    return row;
  }

  rebuild();

  const unsub = store.subscribe((ev) => {
    if (suppress && (ev.type === 'data' || ev.type === 'param')) {
      suppress = false;
      return;
    }
    if (ev.type === 'load') {
      selected = null;
      rebuild();
    } else if (ev.type === 'data' && ev.id === selected) {
      const mod = store.getModule(selected);
      if (mod) paintAll(mod);
    } else if (ev.type === 'param' && ev.id === selected) {
      rebuild();
    } else if (ev.type === 'tempo') {
      const bpmEl = body.querySelector('.rhythm-bpm');
      if (bpmEl) bpmEl.textContent = store.patch.tempo + ' BPM';
    } else if (ev.type === 'module-add' || ev.type === 'module-remove') {
      rebuild();
    }
  });

  let raf = 0;
  let alive = true;
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!selected) return;
    const step = engine.getCurrentStep(selected);
    if (step === playhead) return;
    if (playhead >= 0 && cellEls[playhead]) cellEls[playhead].classList.remove('is-playing');
    playhead = step;
    if (playhead >= 0 && cellEls[playhead]) cellEls[playhead].classList.add('is-playing');
  }
  raf = requestAnimationFrame(frame);

  return {
    hasSeq: () => seqList().length > 0,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      unsub();
    },
  };
}
