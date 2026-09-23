import type { Cable, PortKind, PortRef } from '../../core/types';
import { getModuleDef } from '../../core/moduleDefs';
import { toast } from '../toast';
import type { Ctx, JackInfo } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface CableEntry {
  cable: Cable;
  hit: SVGPathElement;
  vis: SVGPathElement;
  kind: PortKind;
  addedAt: number;
}

interface Pending {
  info: JackInfo;
  anchorRef: PortRef;
  anchorDir: 'in' | 'out';
  kind: PortKind;
  startX: number;
  startY: number;
  activated: boolean;
  pointerId: number;
  pickedUp: Cable | null;
}

function bezier(p1: { x: number; y: number }, p2: { x: number; y: number }, sagMul = 1): string {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const sag = (Math.min(180, dist * 0.35) + 18) * sagMul;
  const c1x = p1.x + dx * 0.25;
  const c1y = p1.y + dy * 0.25 + sag;
  const c2x = p1.x + dx * 0.75;
  const c2y = p1.y + dy * 0.75 + sag;
  return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
}

function bezierPoint(p1: { x: number; y: number }, p2: { x: number; y: number }, t: number, sagMul = 1) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const sag = (Math.min(180, dist * 0.35) + 18) * sagMul;
  const c1 = { x: p1.x + dx * 0.25, y: p1.y + dy * 0.25 + sag };
  const c2 = { x: p1.x + dx * 0.75, y: p1.y + dy * 0.75 + sag };
  const mt = 1 - t;
  const x = mt * mt * mt * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p2.x;
  const y = mt * mt * mt * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p2.y;
  return { x, y };
}

/**
 * The cable layer. Split into two SVGs so cables *look* like they're drawn
 * above every module (as required) without their generous click targets
 * stealing pointer events from jacks that happen to sit under a cable's path:
 *  - `svgHit` sits BELOW the modules layer: interactive hit-paths for
 *    selecting a cable (clickable only where a cable crosses open canvas).
 *  - `svgTop` sits ABOVE the modules layer: the visible strokes, the drag
 *    preview and the remove button (all painted last, on top).
 */
export class CableLayer {
  readonly svgHit: SVGSVGElement;
  readonly svgTop: SVGSVGElement;
  private ctx: Ctx;
  private gHit: SVGGElement;
  private gVis: SVGGElement;
  private previewPath: SVGPathElement;
  private cables = new Map<string, CableEntry>();
  private selectedId: string | null = null;
  private removeBtn: SVGGElement;
  private gateFlash = new Map<string, number>();
  private pending: Pending | null = null;

  constructor(ctx: Ctx) {
    this.ctx = ctx;

    const makeSvg = (cls: string) => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', cls);
      svg.setAttribute('width', '1');
      svg.setAttribute('height', '1');
      svg.style.overflow = 'visible';
      return svg;
    };
    this.svgHit = makeSvg('cable-svg cable-svg-hit');
    this.svgTop = makeSvg('cable-svg cable-svg-top');

    this.gHit = document.createElementNS(SVG_NS, 'g');
    this.svgHit.appendChild(this.gHit);
    this.gVis = document.createElementNS(SVG_NS, 'g');
    this.svgTop.appendChild(this.gVis);

    this.previewPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    this.previewPath.setAttribute('class', 'cable-preview');
    this.previewPath.style.display = 'none';
    this.svgTop.appendChild(this.previewPath);

    this.removeBtn = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    this.removeBtn.setAttribute('class', 'cable-remove-btn');
    this.removeBtn.style.display = 'none';
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', '9');
    const l1 = document.createElementNS(SVG_NS, 'line');
    l1.setAttribute('x1', '-3.5'); l1.setAttribute('y1', '-3.5'); l1.setAttribute('x2', '3.5'); l1.setAttribute('y2', '3.5');
    const l2 = document.createElementNS(SVG_NS, 'line');
    l2.setAttribute('x1', '-3.5'); l2.setAttribute('y1', '3.5'); l2.setAttribute('x2', '3.5'); l2.setAttribute('y2', '-3.5');
    this.removeBtn.appendChild(circle);
    this.removeBtn.appendChild(l1);
    this.removeBtn.appendChild(l2);
    this.removeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedId) this.ctx.store.removeCable(this.selectedId);
    });
    this.svgTop.appendChild(this.removeBtn);

    ctx.engine.on((ev) => {
      if (ev.type === 'gate') this.gateFlash.set(`${ev.module}:${ev.port}`, performance.now());
    });
  }

  rebuildAll() {
    for (const entry of this.cables.values()) {
      entry.hit.remove();
      entry.vis.remove();
    }
    this.cables.clear();
    this.selectedId = null;
    this.removeBtn.style.display = 'none';
    for (const c of this.ctx.store.patch.cables) this.addCable(c);
  }

  addCable(cable: Cable) {
    const srcDef = getModuleDef(this.ctx.store.getModule(cable.from.module)?.type ?? '');
    const kind: PortKind = srcDef?.outputs.find((p) => p.id === cable.from.port)?.kind ?? 'audio';
    const hit = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    hit.setAttribute('class', 'cable-hit');
    hit.style.pointerEvents = 'stroke';
    const vis = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    vis.setAttribute('class', `cable-vis cable-color-${cable.color ?? 0}${kind === 'gate' ? ' cable-gate' : ''}`);
    vis.style.pointerEvents = 'none';
    hit.addEventListener('pointerdown', (e) => e.stopPropagation());
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select(cable.id);
    });
    this.gVis.appendChild(vis);
    this.gHit.appendChild(hit);
    this.cables.set(cable.id, { cable, hit, vis, kind, addedAt: performance.now() });
  }

  removeCable(id: string) {
    const entry = this.cables.get(id);
    if (!entry) return;
    entry.hit.remove();
    entry.vis.remove();
    this.cables.delete(id);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.removeBtn.style.display = 'none';
    }
  }

  select(id: string) {
    this.selectedId = id;
    for (const [cid, entry] of this.cables) entry.vis.classList.toggle('selected', cid === id);
    if (this.ctx.store.selected) this.ctx.store.select(null);
  }

  clearSelection() {
    if (!this.selectedId) return;
    for (const entry of this.cables.values()) entry.vis.classList.remove('selected');
    this.selectedId = null;
    this.removeBtn.style.display = 'none';
  }

  hasSelection(): boolean {
    return !!this.selectedId;
  }

  deleteSelected(): boolean {
    if (!this.selectedId) return false;
    this.ctx.store.removeCable(this.selectedId);
    return true;
  }

  // ---- drag to connect --------------------------------------------------

  handleJackPointerDown(info: JackInfo, e: PointerEvent) {
    let anchorRef: PortRef = { module: info.moduleId, port: info.portId };
    let anchorDir: 'in' | 'out' = info.dir;
    let pickedUp: Cable | null = null;
    if (info.dir === 'in') {
      const existing = this.ctx.store.patch.cables.filter((c) => c.to.module === info.moduleId && c.to.port === info.portId);
      if (existing.length) pickedUp = existing[existing.length - 1];
    }
    this.pending = {
      info,
      anchorRef,
      anchorDir,
      kind: info.kind,
      startX: e.clientX,
      startY: e.clientY,
      activated: false,
      pointerId: e.pointerId,
      pickedUp,
    };
    try {
      info.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    info.el.addEventListener('pointermove', this.onDragMove);
    info.el.addEventListener('pointerup', this.onDragEnd);
    info.el.addEventListener('pointercancel', this.onDragEnd);
  }

  private onDragMove = (e: PointerEvent) => {
    const p = this.pending;
    if (!p) return;
    if (!p.activated) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.hypot(dx, dy) < 4) return;
      p.activated = true;
      if (p.pickedUp) {
        this.ctx.store.removeCable(p.pickedUp.id);
        p.anchorRef = p.pickedUp.from;
        p.anchorDir = 'out';
      }
      this.previewPath.style.display = '';
      this.previewPath.setAttribute('class', `cable-preview cable-color-${this.pending!.info.kind === 'gate' ? 4 : 0}`);
    }
    const anchorPos = this.ctx.jackGeometry.get(
      `${p.anchorRef.module}:${p.anchorRef.port}:${p.anchorDir}`
    ) ?? this.ctx.screenToWorld(e.clientX, e.clientY);
    const pointerWorld = this.ctx.screenToWorld(e.clientX, e.clientY);
    const d =
      p.anchorDir === 'out' ? bezier(anchorPos, pointerWorld) : bezier(pointerWorld, anchorPos);
    this.previewPath.setAttribute('d', d);
    this.updateHighlights(p);
  };

  private onDragEnd = (e: PointerEvent) => {
    const p = this.pending;
    if (!p) return;
    p.info.el.removeEventListener('pointermove', this.onDragMove);
    p.info.el.removeEventListener('pointerup', this.onDragEnd);
    p.info.el.removeEventListener('pointercancel', this.onDragEnd);
    try {
      p.info.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.previewPath.style.display = 'none';
    this.clearHighlights();

    if (!p.activated) {
      if (p.anchorDir === 'out') this.ctx.onJackClick(p.info);
      this.pending = null;
      return;
    }

    const targetEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const dotEl = targetEl?.closest('[data-jack-key]') as HTMLElement | null;
    const key = dotEl?.dataset.jackKey;
    const targetInfo = key ? this.ctx.jacks.get(key) : undefined;

    if (targetInfo && targetInfo.dir !== p.anchorDir) {
      const from = p.anchorDir === 'out' ? p.anchorRef : { module: targetInfo.moduleId, port: targetInfo.portId };
      const to = p.anchorDir === 'out' ? { module: targetInfo.moduleId, port: targetInfo.portId } : p.anchorRef;
      const res = this.ctx.store.connect(from, to);
      if (!res.ok) toast(res.reason, 'warn');
    } else if (targetInfo) {
      toast('Connect an output to an input.', 'warn');
    }
    this.pending = null;
  };

  private updateHighlights(p: Pending) {
    for (const info of this.ctx.jacks.values()) {
      if (info.key === p.info.key) {
        info.el.classList.remove('jack-compat', 'jack-incompat', 'jack-irrelevant');
        continue;
      }
      if (info.dir === p.anchorDir) {
        info.el.classList.add('jack-irrelevant');
        info.el.classList.remove('jack-compat', 'jack-incompat');
        continue;
      }
      const from = p.anchorDir === 'out' ? p.anchorRef : { module: info.moduleId, port: info.portId };
      const to = p.anchorDir === 'out' ? { module: info.moduleId, port: info.portId } : p.anchorRef;
      const ok = this.ctx.store.checkConnection(from, to).ok;
      info.el.classList.toggle('jack-compat', ok);
      info.el.classList.toggle('jack-incompat', !ok);
      info.el.classList.remove('jack-irrelevant');
    }
  }

  private clearHighlights() {
    for (const info of this.ctx.jacks.values()) info.el.classList.remove('jack-compat', 'jack-incompat', 'jack-irrelevant');
  }

  // ---- per-frame ----------------------------------------------------------

  tick(now: number) {
    let selectedMid: { x: number; y: number } | null = null;
    for (const entry of this.cables.values()) {
      const p1 = this.ctx.jackGeometry.get(`${entry.cable.from.module}:${entry.cable.from.port}:out`);
      const p2 = this.ctx.jackGeometry.get(`${entry.cable.to.module}:${entry.cable.to.port}:in`);
      if (!p1 || !p2) continue;
      const age = now - entry.addedAt;
      const overshoot = age < 260 ? 1 + Math.cos((age / 260) * Math.PI * 2.2) * 0.22 * (1 - age / 260) : 1;
      const d = bezier(p1, p2, Math.max(0.4, overshoot));
      entry.hit.setAttribute('d', d);
      entry.vis.setAttribute('d', d);

      const lvl = Math.min(1, this.ctx.engine.getLevel(entry.cable.from));
      const flashAt = this.gateFlash.get(`${entry.cable.from.module}:${entry.cable.from.port}`) ?? -Infinity;
      const flash = Math.max(0, 1 - (now - flashAt) / 220);
      const glow = Math.min(1, lvl + flash * 0.9);
      entry.vis.style.strokeWidth = String(3.2 + glow * 3.4);
      entry.vis.style.opacity = String(0.62 + glow * 0.38);

      if (entry.cable.id === this.selectedId) selectedMid = bezierPoint(p1, p2, 0.5, overshoot);
    }
    if (selectedMid) {
      this.removeBtn.style.display = '';
      this.removeBtn.setAttribute('transform', `translate(${selectedMid.x.toFixed(1)},${selectedMid.y.toFixed(1)})`);
    } else {
      this.removeBtn.style.display = 'none';
    }
  }
}
