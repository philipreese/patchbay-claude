import type { NumberParamDef } from '../core/types';
import { formatParam, normToParam, paramToNorm } from '../core/moduleDefs';
import './knob.css';

export interface KnobOptions {
  def: NumberParamDef;
  value: number;
  /** Called continuously (live) while dragging/scrolling/keying. */
  onChange: (v: number) => void;
}

const START = -135; // degrees, 0 = straight up, clockwise positive
const END = 135;
const SWEEP = END - START;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const large = hi - lo > 180 ? 1 : 0;
  const p1 = polar(cx, cy, r, lo);
  const p2 = polar(cx, cy, r, hi);
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
}

/** Reusable bakelite knob for a NumberParamDef. Emits live values via onChange. */
export class Knob {
  readonly el: HTMLDivElement;
  private def: NumberParamDef;
  private value: number;
  private onChange: (v: number) => void;
  private knobEl: HTMLDivElement;
  private arcEl: SVGPathElement;
  private pointerEl: HTMLDivElement;
  private valueEl: HTMLDivElement;
  private dragging = false;
  private dragStartY = 0;
  private dragStartNorm = 0;

  constructor(opts: KnobOptions) {
    this.def = opts.def;
    this.value = opts.value;
    this.onChange = opts.onChange;

    this.el = document.createElement('div');
    this.el.className = 'knob-wrap';

    const knob = document.createElement('div');
    knob.className = 'knob';
    knob.tabIndex = 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', this.def.label);
    knob.setAttribute('aria-valuemin', String(this.def.min));
    knob.setAttribute('aria-valuemax', String(this.def.max));
    this.knobEl = knob;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    track.setAttribute('class', 'knob-track');
    track.setAttribute('d', arcPath(20, 20, 17, START, END));
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('class', 'knob-arc');
    this.arcEl = arc;
    svg.appendChild(track);
    svg.appendChild(arc);
    knob.appendChild(svg);

    const body = document.createElement('div');
    body.className = 'knob-body';
    const ptr = document.createElement('div');
    ptr.className = 'knob-pointer';
    this.pointerEl = ptr;
    body.appendChild(ptr);
    knob.appendChild(body);

    const value = document.createElement('div');
    value.className = 'knob-value';
    this.valueEl = value;
    knob.appendChild(value);

    const label = document.createElement('div');
    label.className = 'knob-label';
    label.textContent = this.def.label;
    if (this.def.hint) knob.title = `${this.def.label}: ${this.def.hint}`;

    this.el.appendChild(knob);
    this.el.appendChild(label);

    knob.addEventListener('pointerdown', this.onPointerDown);
    knob.addEventListener('wheel', this.onWheel, { passive: false });
    knob.addEventListener('dblclick', this.onDblClick);
    knob.addEventListener('keydown', this.onKeyDown);

    this.render();
  }

  setValue(v: number) {
    if (this.dragging) return; // don't fight the user's own drag
    if (v === this.value) return;
    this.value = v;
    this.render();
  }

  setDisabledLook(disabled: boolean) {
    this.el.classList.toggle('knob-disabled-look', disabled);
  }

  private norm(): number {
    return paramToNorm(this.def, this.value);
  }

  private render() {
    const n = this.norm();
    const angle = START + n * SWEEP;
    this.pointerEl.style.transform = `rotate(${angle}deg)`;
    const centerAngle = this.def.bipolar ? START + 0.5 * SWEEP : START;
    this.arcEl.setAttribute('d', arcPath(20, 20, 17, centerAngle, angle));
    this.knobEl.setAttribute('aria-valuenow', String(this.value));
    this.knobEl.setAttribute('aria-valuetext', formatParam(this.def, this.value));
    this.valueEl.textContent = formatParam(this.def, this.value);
  }

  private set(v: number) {
    v = Math.min(this.def.max, Math.max(this.def.min, v));
    this.value = v;
    this.render();
    this.onChange(v);
  }

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = true;
    this.dragStartY = e.clientY;
    this.dragStartNorm = this.norm();
    this.el.classList.add('knob-active');
    this.knobEl.setPointerCapture(e.pointerId);
    this.knobEl.focus();
    this.knobEl.addEventListener('pointermove', this.onPointerMove);
    this.knobEl.addEventListener('pointerup', this.onPointerUp);
    this.knobEl.addEventListener('pointercancel', this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const fine = e.shiftKey;
    const dy = this.dragStartY - e.clientY;
    const range = fine ? 900 : 220;
    const n = Math.min(1, Math.max(0, this.dragStartNorm + dy / range));
    this.set(normToParam(this.def, n));
  };

  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    this.el.classList.remove('knob-active');
    try {
      this.knobEl.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.knobEl.removeEventListener('pointermove', this.onPointerMove);
    this.knobEl.removeEventListener('pointerup', this.onPointerUp);
    this.knobEl.removeEventListener('pointercancel', this.onPointerUp);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fine = e.shiftKey;
    const step = fine ? 0.005 : 0.02;
    const n = Math.min(1, Math.max(0, this.norm() + (e.deltaY < 0 ? step : -step)));
    this.set(normToParam(this.def, n));
  };

  private onDblClick = (e: MouseEvent) => {
    e.stopPropagation();
    this.set(this.def.default);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    let n = this.norm();
    const step = e.shiftKey ? 0.005 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= step;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    this.set(normToParam(this.def, Math.min(1, Math.max(0, n))));
  };
}
