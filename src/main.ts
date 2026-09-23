import './styles/tokens.css';
import './styles/base.css';
import { PatchStore } from './core/store';
import { createEngine } from './audio/engine';
import { PRESETS } from './presets';

const store = new PatchStore(PRESETS[0].make());
const engine = createEngine(store);

async function boot() {
  // Views are loaded dynamically so a failure in one doesn't blank the app.
  try {
    const { mountCanvas } = await import('./ui/canvas');
    mountCanvas(document.getElementById('canvas-root')!, store, engine);
  } catch (e) { console.warn('canvas not ready', e); }
  try {
    const { mountDock } = await import('./ui/dock');
    mountDock(document.getElementById('dock')!, document.getElementById('playbar')!, store, engine);
  } catch (e) { console.warn('dock not ready', e); }
}
boot();
(window as any).__patchbay = { store, engine };
