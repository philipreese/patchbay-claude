import type { ModuleDef, ParamDef, PatchModule, PortDef } from '../../core/types';
import { getModuleDef } from '../../core/moduleDefs';
import { Knob } from '../knob';
import { SeqBody } from './sequencer';
import type { Ctx, JackInfo } from './types';
import { jackKey } from './types';

interface ChipGroup {
  container: HTMLElement;
  buttons: Map<string, HTMLButtonElement>;
}

/** One module card: header, jacks, params (knobs/chips), and (for seq) the step body. */
export class ModuleCard {
  readonly id: string;
  readonly el: HTMLDivElement;
  private ctx: Ctx;
  private def: ModuleDef;
  private knobs = new Map<string, Knob>();
  private chips = new Map<string, ChipGroup>();
  private jackKeys: string[] = [];
  private seqBody?: SeqBody;
  private resizeObs: ResizeObserver;
  private titleEl!: HTMLDivElement;

  constructor(ctx: Ctx, module: PatchModule) {
    this.ctx = ctx;
    this.id = module.id;
    this.def = getModuleDef(module.type)!;
    this.el = document.createElement('div');
    this.el.className = `module-card cat-${this.def.category}`;
    this.el.style.width = `${this.def.width}px`;
    this.el.dataset.moduleId = module.id;
    this.applyPosition(module);
    this.build(module);

    this.el.addEventListener('pointerdown', () => this.ctx.store.select(this.id));

    this.resizeObs = new ResizeObserver(() => this.ctx.recalcJackGeometry(this.id));
    this.resizeObs.observe(this.el);
  }

  private build(module: PatchModule) {
    const header = document.createElement('div');
    header.className = 'module-header';
    header.title = this.def.blurb;

    const titleWrap = document.createElement('div');
    titleWrap.className = 'module-title-wrap';
    const title = document.createElement('div');
    title.className = 'module-title';
    title.textContent = module.label ?? this.def.title;
    this.titleEl = title;
    const caption = document.createElement('div');
    caption.className = 'module-caption';
    caption.textContent = this.def.title.toUpperCase();
    titleWrap.appendChild(title);
    titleWrap.appendChild(caption);
    header.appendChild(titleWrap);

    if (this.ctx.store.canRemove(this.id)) {
      const del = document.createElement('button');
      del.className = 'module-delete';
      del.type = 'button';
      del.textContent = '×';
      del.title = 'Delete module';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ctx.store.removeModule(this.id);
      });
      header.appendChild(del);
    }

    this.wireHeaderDrag(header);
    this.el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'module-body';

    const ports = document.createElement('div');
    ports.className = 'module-ports';
    const inCol = document.createElement('div');
    inCol.className = 'port-col port-col-in';
    const outCol = document.createElement('div');
    outCol.className = 'port-col port-col-out';
    for (const p of this.def.inputs) inCol.appendChild(this.buildPortRow(p, 'in'));
    for (const p of this.def.outputs) outCol.appendChild(this.buildPortRow(p, 'out'));
    ports.appendChild(inCol);
    ports.appendChild(outCol);
    body.appendChild(ports);

    if (this.def.params.length) {
      const params = document.createElement('div');
      params.className = 'module-params';
      for (const def of this.def.params) params.appendChild(this.buildParam(module, def));
      body.appendChild(params);
    }

    if (module.type === 'seq') {
      this.seqBody = new SeqBody(this.ctx.store, this.id);
      body.appendChild(this.seqBody.el);
    }

    this.el.appendChild(body);
    this.applyDelayTimeLook(module);
  }

  private buildPortRow(port: PortDef, dir: 'in' | 'out'): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `port-row port-row-${dir} kind-${port.kind}`;

    const dot = document.createElement('div');
    dot.className = `jack-dot jack-${port.kind}`;
    dot.title = `${port.label} — ${port.hint}`;
    dot.dataset.jackKey = jackKey(this.id, port.id, dir);

    const label = document.createElement('div');
    label.className = 'jack-label';
    label.textContent = port.label;

    let led: HTMLDivElement | undefined;
    if (dir === 'out') {
      led = document.createElement('div');
      led.className = 'jack-led';
      dot.appendChild(led);
    }

    dot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.onJackPointerDown(this.jackInfo(port, dir, dot, led), e);
    });

    if (dir === 'in') {
      row.appendChild(dot);
      row.appendChild(label);
    } else {
      row.appendChild(label);
      row.appendChild(dot);
    }

    const info = this.jackInfo(port, dir, dot, led);
    this.ctx.registerJack(info);
    this.jackKeys.push(info.key);
    return row;
  }

  private jackInfo(port: PortDef, dir: 'in' | 'out', el: HTMLElement, ledEl?: HTMLElement): JackInfo {
    return { key: jackKey(this.id, port.id, dir), moduleId: this.id, portId: port.id, dir, kind: port.kind, el, ledEl };
  }

  private buildParam(module: PatchModule, def: ParamDef): HTMLElement {
    if (def.type === 'number') {
      const knob = new Knob({
        def,
        value: module.params[def.key] as number,
        onChange: (v) => this.ctx.store.setParam(this.id, def.key, v),
      });
      this.knobs.set(def.key, knob);
      return knob.el;
    }
    const wrap = document.createElement('div');
    wrap.className = 'chip-row';
    if (def.hint) wrap.title = `${def.label}: ${def.hint}`;
    const label = document.createElement('div');
    label.className = 'chip-label';
    label.textContent = def.label;
    const group = document.createElement('div');
    group.className = 'chip-group';
    const buttons = new Map<string, HTMLButtonElement>();
    def.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = def.labels?.[i] ?? opt;
      btn.classList.toggle('active', module.params[def.key] === opt);
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ctx.store.setParam(this.id, def.key, opt);
      });
      group.appendChild(btn);
      buttons.set(opt, btn);
    });
    wrap.appendChild(label);
    wrap.appendChild(group);
    this.chips.set(def.key, { container: group, buttons });
    return wrap;
  }

  private wireHeaderDrag(header: HTMLElement) {
    let dragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startX = 0;
    let startY = 0;
    header.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.module-delete')) return;
      e.stopPropagation();
      dragging = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      const m = this.ctx.store.getModule(this.id);
      startX = m?.x ?? 0;
      startY = m?.y ?? 0;
      this.ctx.store.select(this.id);
      this.el.classList.add('dragging');
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const z = this.ctx.view.zoom;
      const dx = (e.clientX - startClientX) / z;
      const dy = (e.clientY - startClientY) / z;
      this.ctx.store.moveModule(this.id, startX + dx, startY + dy);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove('dragging');
      try {
        header.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  }

  applyPosition(module: PatchModule) {
    this.el.style.left = `${module.x}px`;
    this.el.style.top = `${module.y}px`;
  }

  updateParam(key: string, value: unknown) {
    const knob = this.knobs.get(key);
    if (knob) knob.setValue(value as number);
    const chip = this.chips.get(key);
    if (chip) chip.buttons.forEach((btn, opt) => btn.classList.toggle('active', opt === value));
    if (this.def.type === 'delay' && key === 'sync') {
      const m = this.ctx.store.getModule(this.id);
      if (m) this.applyDelayTimeLook(m);
    }
  }

  private applyDelayTimeLook(module: PatchModule) {
    if (this.def.type !== 'delay') return;
    const timeKnob = this.knobs.get('time');
    if (timeKnob) timeKnob.setDisabledLook(module.params.sync !== 'free');
  }

  updateData() {
    this.seqBody?.update();
  }

  updateMeta() {
    const m = this.ctx.store.getModule(this.id);
    if (m) this.titleEl.textContent = m.label ?? this.def.title;
  }

  setSelected(sel: boolean) {
    this.el.classList.toggle('selected', sel);
  }

  tick() {
    for (const key of this.jackKeys) {
      const info = this.ctx.jacks.get(key);
      if (!info || info.dir !== 'out' || !info.ledEl) continue;
      const lvl = Math.min(1, this.ctx.engine.getLevel({ module: info.moduleId, port: info.portId }));
      info.ledEl.style.opacity = String(0.18 + lvl * 0.82);
      info.ledEl.style.boxShadow = lvl > 0.04 ? `0 0 ${4 + lvl * 9}px var(--hot-2)` : 'none';
    }
    if (this.seqBody) this.seqBody.tickPlayhead(this.ctx.engine.getCurrentStep(this.id));
  }

  destroy() {
    this.resizeObs.disconnect();
    for (const key of this.jackKeys) this.ctx.unregisterJack(key);
    this.el.remove();
  }
}
