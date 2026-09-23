// Big, tactile "macro" knob: drag (vertical or horizontal), wheel, arrow keys, touch.
// Deliberately independent from any module-knob widget another worker may build.

export interface MacroKnobOptions {
  label: string;
  hint?: string;
  color: string; // CSS color for the glowing arc
  getValue: () => number; // 0..1
  onChange: (v: number) => void; // called continuously while dragging
}

export interface MacroKnob {
  el: HTMLElement;
  /** Re-read getValue() and redraw (cheap: only touches the arc path + text). */
  refresh(): void;
}

const START_DEG = 225; // bottom-left
const SWEEP_DEG = 270; // leaves a 90deg gap at the bottom
const DRAG_PX = 220; // px of combined drag travel for the full 0..1 range

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createMacroKnob(opts: MacroKnobOptions): MacroKnob {
  const wrap = document.createElement('div');
  wrap.className = 'macro-knob';
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('aria-label', opts.label);
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  wrap.style.setProperty('--knob-color', opts.color);

  const ringWrap = document.createElement('div');
  ringWrap.className = 'macro-knob-ring';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('class', 'macro-knob-track');
  track.setAttribute('d', arcPath(50, 50, 42, START_DEG, SWEEP_DEG));
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('class', 'macro-knob-arc');
  svg.appendChild(track);
  svg.appendChild(arc);
  ringWrap.appendChild(svg);

  const valueEl = document.createElement('div');
  valueEl.className = 'macro-knob-value';

  ringWrap.appendChild(valueEl);
  wrap.appendChild(ringWrap);

  const labelEl = document.createElement('div');
  labelEl.className = 'macro-knob-label';
  labelEl.textContent = opts.label;
  wrap.appendChild(labelEl);

  if (opts.hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'macro-knob-hint';
    hintEl.textContent = opts.hint;
    wrap.appendChild(hintEl);
  }

  let value = clamp01(opts.getValue());

  function draw() {
    const sweep = SWEEP_DEG * value;
    if (sweep < 0.5) {
      arc.setAttribute('d', '');
    } else {
      arc.setAttribute('d', arcPath(50, 50, 42, START_DEG, sweep));
    }
    valueEl.textContent = Math.round(value * 100) + '%';
    wrap.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    wrap.classList.toggle('is-active', value > 0.001);
  }

  function setValue(v: number, fire: boolean) {
    value = clamp01(v);
    draw();
    if (fire) opts.onChange(value);
  }

  // ---- pointer drag (vertical or horizontal, combined) ----
  let dragging = false;
  let startVal = 0;
  let startX = 0;
  let startY = 0;

  wrap.addEventListener('pointerdown', (e) => {
    dragging = true;
    startVal = value;
    startX = e.clientX;
    startY = e.clientY;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('is-dragging');
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = startY - e.clientY;
    setValue(startVal + (dx + dy) / DRAG_PX, true);
  });
  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('is-dragging');
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('lostpointercapture', () => {
    dragging = false;
    wrap.classList.remove('is-dragging');
  });

  // ---- wheel ----
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setValue(value - e.deltaY * 0.0016, true);
    },
    { passive: false },
  );

  // ---- keyboard ----
  wrap.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      setValue(value + big, true);
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      setValue(value - big, true);
      e.preventDefault();
    } else if (e.key === 'Home') {
      setValue(0, true);
      e.preventDefault();
    } else if (e.key === 'End') {
      setValue(1, true);
      e.preventDefault();
    }
  });

  draw();

  return {
    el: wrap,
    refresh() {
      if (dragging) return; // don't fight the user's own gesture
      const v = clamp01(opts.getValue());
      if (Math.abs(v - value) < 0.0005) return;
      value = v;
      draw();
    },
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
