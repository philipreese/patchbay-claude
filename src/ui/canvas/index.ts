import type { PatchStore, StoreEvent } from '../../core/store';
import type { EngineView } from '../../audio/engineApi';
import type { PortRef } from '../../core/types';
import { CableLayer } from './cables';
import { ModuleCard } from './moduleCard';
import { openPalette } from './palette';
import type { Ctx, JackInfo, ViewState } from './types';
import { jackKey } from './types';
import './canvas.css';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.6;
const GRID_SIZE = 26;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function isTextEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

class CanvasController implements Ctx {
  store: PatchStore;
  engine: EngineView;
  root: HTMLElement;
  world: HTMLElement;
  view: ViewState = { x: 0, y: 0, zoom: 1 };
  jacks = new Map<string, JackInfo>();
  jackGeometry = new Map<string, { x: number; y: number }>();

  private gridEl: HTMLDivElement;
  private modulesLayer: HTMLDivElement;
  private overlay: HTMLDivElement;
  private modules = new Map<string, ModuleCard>();
  private cableLayer: CableLayer;
  private probedKey: string | null = null;

  private activePointers = new Map<number, { x: number; y: number }>();
  private panState: { startX: number; startY: number; viewX: number; viewY: number } | null = null;
  private pinchState: { startDist: number; startZoom: number; anchor: { x: number; y: number } } | null = null;

  constructor(root: HTMLElement, store: PatchStore, engine: EngineView) {
    this.store = store;
    this.engine = engine;
    this.root = root;
    root.classList.add('canvas-surface');

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'canvas-grid';
    root.appendChild(this.gridEl);

    this.world = document.createElement('div');
    this.world.className = 'canvas-world';
    root.appendChild(this.world);

    this.modulesLayer = document.createElement('div');
    this.modulesLayer.className = 'canvas-modules';
    this.world.appendChild(this.modulesLayer);

    this.cableLayer = new CableLayer(this);
    this.world.appendChild(this.cableLayer.svg);

    this.overlay = this.buildOverlay();
    root.appendChild(this.overlay);

    this.wirePanZoom();
    this.wireKeys();

    store.subscribe((ev) => this.onStoreEvent(ev));

    this.rebuildAll();
    if (store.patch.view) {
      this.view = { ...store.patch.view };
      this.applyTransform();
    } else {
      this.fitView();
    }

    requestAnimationFrame(this.tick);
  }

  // ---- Ctx implementation --------------------------------------------------

  registerJack(info: JackInfo) {
    this.jacks.set(info.key, info);
  }

  unregisterJack(key: string) {
    this.jacks.delete(key);
    this.jackGeometry.delete(key);
  }

  recalcJackGeometry(moduleId: string) {
    const worldRect = this.world.getBoundingClientRect();
    const z = this.view.zoom || 1;
    for (const info of this.jacks.values()) {
      if (info.moduleId !== moduleId) continue;
      const r = info.el.getBoundingClientRect();
      const x = (r.left + r.width / 2 - worldRect.left) / z;
      const y = (r.top + r.height / 2 - worldRect.top) / z;
      this.jackGeometry.set(info.key, { x, y });
    }
  }

  screenToWorld(sx: number, sy: number) {
    const rect = this.root.getBoundingClientRect();
    return { x: (sx - rect.left - this.view.x) / this.view.zoom, y: (sy - rect.top - this.view.y) / this.view.zoom };
  }

  openPalette(worldX: number, worldY: number) {
    openPalette(this, worldX, worldY);
  }

  onJackPointerDown(info: JackInfo, e: PointerEvent) {
    this.cableLayer.handleJackPointerDown(info, e);
  }

  onJackClick(info: JackInfo) {
    if (info.dir !== 'out') return;
    const cur = this.store.probe;
    if (cur && cur.module === info.moduleId && cur.port === info.portId) this.store.setProbe(null);
    else this.store.setProbe({ module: info.moduleId, port: info.portId });
  }

  // ---- build / rebuild ------------------------------------------------------

  private buildOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'canvas-overlay';

    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'canvas-overlay-group';
    const zoomOut = this.overlayButton('−', 'Zoom out');
    const fit = this.overlayButton('Fit', 'Frame all modules');
    fit.classList.add('canvas-overlay-fit');
    const zoomIn = this.overlayButton('+', 'Zoom in');
    zoomOut.addEventListener('click', () => this.zoomByFactor(0.8));
    zoomIn.addEventListener('click', () => this.zoomByFactor(1.25));
    fit.addEventListener('click', () => this.fitView());
    zoomGroup.appendChild(zoomOut);
    zoomGroup.appendChild(fit);
    zoomGroup.appendChild(zoomIn);

    const addBtn = this.overlayButton('+ Add module', 'Add a module');
    addBtn.classList.add('canvas-overlay-add');
    addBtn.addEventListener('click', () => {
      const rect = this.root.getBoundingClientRect();
      const c = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      this.openPalette(c.x, c.y);
    });

    overlay.appendChild(zoomGroup);
    overlay.appendChild(addBtn);
    return overlay;
  }

  private overlayButton(label: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-overlay-btn';
    btn.textContent = label;
    btn.title = title;
    return btn;
  }

  private rebuildAll() {
    for (const card of this.modules.values()) card.destroy();
    this.modules.clear();
    this.jacks.clear();
    this.jackGeometry.clear();

    for (const m of this.store.patch.modules) {
      const card = new ModuleCard(this, m);
      this.modulesLayer.appendChild(card.el);
      this.modules.set(m.id, card);
    }
    for (const id of this.modules.keys()) this.recalcJackGeometry(id);
    this.cableLayer.rebuildAll();
    this.syncSelection();
    this.syncProbe();
  }

  private onStoreEvent(ev: StoreEvent) {
    switch (ev.type) {
      case 'load':
        this.rebuildAll();
        if (this.store.patch.view) {
          this.view = { ...this.store.patch.view };
          this.applyTransform();
        } else {
          this.fitView();
        }
        break;
      case 'module-add': {
        const card = new ModuleCard(this, ev.module);
        this.modulesLayer.appendChild(card.el);
        this.modules.set(ev.module.id, card);
        this.recalcJackGeometry(ev.module.id);
        break;
      }
      case 'module-remove': {
        const card = this.modules.get(ev.id);
        card?.destroy();
        this.modules.delete(ev.id);
        break;
      }
      case 'module-move': {
        const card = this.modules.get(ev.id);
        const m = this.store.getModule(ev.id);
        if (card && m) {
          card.applyPosition(m);
          this.recalcJackGeometry(ev.id);
        }
        break;
      }
      case 'param':
        this.modules.get(ev.id)?.updateParam(ev.key, ev.value);
        break;
      case 'data':
        this.modules.get(ev.id)?.updateData();
        break;
      case 'cable-add':
        this.cableLayer.addCable(ev.cable);
        break;
      case 'cable-remove':
        this.cableLayer.removeCable(ev.cable.id);
        break;
      case 'select':
        this.syncSelection();
        break;
      case 'probe':
        this.syncProbe();
        break;
      case 'meta':
        for (const card of this.modules.values()) card.updateMeta();
        break;
      default:
        break;
    }
  }

  private syncSelection() {
    for (const [id, card] of this.modules) card.setSelected(id === this.store.selected);
    if (this.store.selected) this.cableLayer.clearSelection();
  }

  private syncProbe() {
    if (this.probedKey) this.jacks.get(this.probedKey)?.el.classList.remove('jack-probed');
    const ref: PortRef | null = this.store.probe;
    this.probedKey = ref ? jackKey(ref.module, ref.port, 'out') : null;
    if (this.probedKey) this.jacks.get(this.probedKey)?.el.classList.add('jack-probed');
  }

  // ---- view: pan / zoom / fit -----------------------------------------------

  applyTransform() {
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
    this.gridEl.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
    this.gridEl.style.backgroundSize = `${GRID_SIZE * this.view.zoom}px ${GRID_SIZE * this.view.zoom}px`;
  }

  fitView() {
    const entries = [...this.modules.entries()];
    if (!entries.length) {
      const rect = this.root.getBoundingClientRect();
      this.view = { x: rect.width / 2, y: rect.height / 2, zoom: 1 };
      this.applyTransform();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, card] of entries) {
      const m = this.store.getModule(id);
      if (!m) continue;
      const w = card.el.offsetWidth || 160;
      const h = card.el.offsetHeight || 120;
      minX = Math.min(minX, m.x);
      minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + w);
      maxY = Math.max(maxY, m.y + h);
    }
    const pad = 80;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const cw = Math.max(1, maxX - minX);
    const ch = Math.max(1, maxY - minY);
    const rect = this.root.getBoundingClientRect();
    const zoom = clamp(Math.min(rect.width / cw, rect.height / ch), MIN_ZOOM, MAX_ZOOM);
    this.view.zoom = zoom;
    this.view.x = rect.width / 2 - (minX + cw / 2) * zoom;
    this.view.y = rect.height / 2 - (minY + ch / 2) * zoom;
    this.applyTransform();
  }

  private zoomByFactor(factor: number) {
    const rect = this.root.getBoundingClientRect();
    this.zoomAround(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private zoomAround(factor: number, screenX: number, screenY: number) {
    const rect = this.root.getBoundingClientRect();
    const anchor = this.screenToWorld(screenX, screenY);
    const newZoom = clamp(this.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.view.zoom = newZoom;
    this.view.x = screenX - rect.left - anchor.x * newZoom;
    this.view.y = screenY - rect.top - anchor.y * newZoom;
    this.applyTransform();
  }

  private wirePanZoom() {
    const root = this.root;

    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0016);
        this.zoomAround(factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    root.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.module-card')) return;
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.openPalette(w.x, w.y);
    });

    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.module-card, .canvas-overlay')) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (this.activePointers.size === 1) {
        this.panState = { startX: e.clientX, startY: e.clientY, viewX: this.view.x, viewY: this.view.y };
        this.pinchState = null;
      } else if (this.activePointers.size === 2) {
        this.panState = null;
        this.pinchState = this.beginPinch();
      }
    });

    root.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.activePointers.size === 1 && this.panState) {
        this.view.x = this.panState.viewX + (e.clientX - this.panState.startX);
        this.view.y = this.panState.viewY + (e.clientY - this.panState.startY);
        this.applyTransform();
      } else if (this.activePointers.size === 2 && this.pinchState) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const rect = root.getBoundingClientRect();
        const newZoom = clamp(this.pinchState.startZoom * (dist / this.pinchState.startDist), MIN_ZOOM, MAX_ZOOM);
        this.view.zoom = newZoom;
        this.view.x = mid.x - rect.left - this.pinchState.anchor.x * newZoom;
        this.view.y = mid.y - rect.top - this.pinchState.anchor.y * newZoom;
        this.applyTransform();
      }
    });

    const endPointer = (e: PointerEvent) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.delete(e.pointerId);
      try {
        root.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (this.activePointers.size === 1) {
        const [p] = this.activePointers.values();
        this.panState = { startX: p.x, startY: p.y, viewX: this.view.x, viewY: this.view.y };
        this.pinchState = null;
      } else if (this.activePointers.size === 0) {
        this.panState = null;
        this.pinchState = null;
      }
    };
    root.addEventListener('pointerup', endPointer);
    root.addEventListener('pointercancel', endPointer);
  }

  private beginPinch() {
    const pts = [...this.activePointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    return { startDist: dist || 1, startZoom: this.view.zoom, anchor: this.screenToWorld(mid.x, mid.y) };
  }

  private wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTextEditable(document.activeElement)) return;
      if (this.cableLayer.hasSelection()) {
        this.cableLayer.deleteSelected();
        e.preventDefault();
        return;
      }
      if (this.store.selected) {
        this.store.removeModule(this.store.selected);
        e.preventDefault();
      }
    });
  }

  private tick = (now: number) => {
    this.cableLayer.tick(now);
    for (const card of this.modules.values()) card.tick();
    requestAnimationFrame(this.tick);
  };
}

/** Mount the pan/zoom module canvas into `root`. */
export function mountCanvas(root: HTMLElement, store: PatchStore, engine: EngineView): { fitView(): void } {
  const controller = new CanvasController(root, store, engine);
  return { fitView: () => controller.fitView() };
}
