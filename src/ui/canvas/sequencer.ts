import type { PatchStore } from '../../core/store';
import type { SeqStep } from '../../core/types';
import { SCALES, noteName } from '../../core/moduleDefs';

const MIN_NOTE = -24;
const MAX_NOTE = 24;

/** All semitone offsets within -24..24 that lie in the given scale (relative to root). */
function scaleOffsets(scaleName: string): number[] {
  const tones = SCALES[scaleName] ?? SCALES.chromatic;
  const set = new Set<number>();
  for (let oct = -3; oct <= 3; oct++) {
    for (const t of tones) {
      const v = oct * 12 + t;
      if (v >= MIN_NOTE && v <= MAX_NOTE) set.add(v);
    }
  }
  if (!set.has(0)) set.add(0);
  return [...set].sort((a, b) => a - b);
}

function nearestIndex(arr: number[], v: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The 16-step body of a Sequencer module card. Comfortable to use while playing. */
export class SeqBody {
  readonly el: HTMLDivElement;
  private store: PatchStore;
  private moduleId: string;
  private cols: HTMLDivElement[] = [];
  private cells: HTMLDivElement[] = [];
  private notes: HTMLDivElement[] = [];
  private accents: HTMLButtonElement[] = [];
  private slides: HTMLButtonElement[] = [];
  private lastStep = -1;

  constructor(store: PatchStore, moduleId: string) {
    this.store = store;
    this.moduleId = moduleId;
    this.el = document.createElement('div');
    this.el.className = 'seq-body';

    for (let i = 0; i < 16; i++) {
      const col = document.createElement('div');
      col.className = 'seq-step';
      col.dataset.i = String(i);

      const note = document.createElement('div');
      note.className = 'seq-note';
      col.appendChild(note);

      const cell = document.createElement('div');
      cell.className = 'seq-cell';
      cell.title = 'Click to toggle · drag or scroll to change the note';
      col.appendChild(cell);

      const flags = document.createElement('div');
      flags.className = 'seq-flags';
      const accent = document.createElement('button');
      accent.className = 'seq-flag seq-accent';
      accent.type = 'button';
      accent.title = 'Accent';
      accent.textContent = 'A';
      const slide = document.createElement('button');
      slide.className = 'seq-flag seq-slide';
      slide.type = 'button';
      slide.title = 'Slide';
      slide.textContent = 'S';
      flags.appendChild(accent);
      flags.appendChild(slide);
      col.appendChild(flags);

      accent.addEventListener('pointerdown', (e) => e.stopPropagation());
      accent.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mutate(i, (s) => (s.accent = !s.accent));
      });
      slide.addEventListener('pointerdown', (e) => e.stopPropagation());
      slide.addEventListener('click', (e) => {
        e.stopPropagation();
        this.mutate(i, (s) => (s.slide = !s.slide));
      });

      this.wireCell(cell, i);

      this.el.appendChild(col);
      this.cols.push(col);
      this.cells.push(cell);
      this.notes.push(note);
      this.accents.push(accent);
      this.slides.push(slide);
    }

    this.update();
  }

  private wireCell(cell: HTMLDivElement, i: number) {
    let dragging = false;
    let startY = 0;
    let startIndex = 0;
    let moved = false;
    let arr: number[] = [];

    cell.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      moved = false;
      startY = e.clientY;
      const m = this.store.getModule(this.moduleId);
      const scale = (m?.params.scale as string) ?? 'minor';
      arr = scaleOffsets(scale);
      const step = m?.data?.steps[i];
      startIndex = nearestIndex(arr, step?.note ?? 0);
      cell.setPointerCapture(e.pointerId);
    });
    cell.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 5) moved = true;
      if (!moved) return;
      const steps = Math.round(dy / 14);
      const idx = Math.min(arr.length - 1, Math.max(0, startIndex + steps));
      this.mutate(i, (s) => (s.note = arr[idx]));
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        cell.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!moved) this.mutate(i, (s) => (s.on = !s.on));
    };
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', end);
    cell.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = this.store.getModule(this.moduleId);
      const scale = (m?.params.scale as string) ?? 'minor';
      const a = scaleOffsets(scale);
      const step = m?.data?.steps[i];
      const idx = nearestIndex(a, step?.note ?? 0);
      const next = Math.min(a.length - 1, Math.max(0, idx + (e.deltaY < 0 ? 1 : -1)));
      this.mutate(i, (s) => (s.note = a[next]));
    });
  }

  private mutate(i: number, fn: (s: SeqStep) => void) {
    const m = this.store.getModule(this.moduleId);
    if (!m?.data) return;
    const steps = m.data.steps.map((s) => ({ ...s }));
    fn(steps[i]);
    this.store.setData(this.moduleId, { steps });
  }

  /** Re-read module data/params and refresh the whole grid (cheap: 16 cells). */
  update() {
    const m = this.store.getModule(this.moduleId);
    if (!m?.data) return;
    const root = (m.params.root as number) ?? 48;
    const length = (m.params.length as number) ?? 16;
    for (let i = 0; i < 16; i++) {
      const s = m.data.steps[i];
      const col = this.cols[i];
      col.classList.toggle('seq-dim', i >= length);
      this.cells[i].classList.toggle('seq-on', s.on);
      this.notes[i].textContent = noteName(root + s.note);
      this.accents[i].classList.toggle('active', s.accent);
      this.slides[i].classList.toggle('active', s.slide);
    }
  }

  tickPlayhead(step: number) {
    if (step === this.lastStep) return;
    if (this.lastStep >= 0 && this.lastStep < 16) this.cols[this.lastStep].classList.remove('seq-playing');
    if (step >= 0 && step < 16) this.cols[step].classList.add('seq-playing');
    this.lastStep = step;
  }
}
