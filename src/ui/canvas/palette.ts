import { allModuleDefs } from '../../core/moduleDefs';
import type { ModuleDef } from '../../core/types';
import { toast } from '../toast';
import type { Ctx } from './types';

const CATEGORY_LABEL: Record<ModuleDef['category'], string> = {
  play: 'Play',
  source: 'Sources',
  shape: 'Shape',
  modulate: 'Modulate',
  effect: 'Effects',
  out: 'Output',
};

/** Modal "+ Add module" palette, grouped by category. */
export function openPalette(ctx: Ctx, worldX: number, worldY: number) {
  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay';

  const modal = document.createElement('div');
  modal.className = 'palette-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Add module');

  const header = document.createElement('div');
  header.className = 'palette-header';
  header.innerHTML = '<div class="palette-title">Add a module</div>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'palette-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const list = document.createElement('div');
  list.className = 'palette-list';
  modal.appendChild(list);

  const byCategory = new Map<string, ModuleDef[]>();
  for (const def of allModuleDefs()) {
    if (!byCategory.has(def.category)) byCategory.set(def.category, []);
    byCategory.get(def.category)!.push(def);
  }

  for (const [cat, defs] of byCategory) {
    const group = document.createElement('div');
    group.className = 'palette-group';
    const title = document.createElement('div');
    title.className = 'palette-group-title';
    title.textContent = CATEGORY_LABEL[cat as ModuleDef['category']] ?? cat;
    group.appendChild(title);
    for (const def of defs) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `palette-item cat-${def.category}`;
      item.innerHTML = `<div class="palette-item-title">${def.title}</div><div class="palette-item-blurb">${def.blurb}</div>`;
      item.addEventListener('click', () => {
        const m = ctx.store.addModule(def.type, worldX, worldY);
        if (!m) {
          toast(`Only one ${def.title} allowed.`, 'warn');
          return;
        }
        ctx.store.select(m.id);
        close();
      });
      group.appendChild(item);
    }
    list.appendChild(group);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}
