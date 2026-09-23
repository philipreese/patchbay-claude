import './overlay.css';
import type { PatchStore } from '../core/store';
import type { Engine } from '../audio/engine';
import { PRESETS } from '../presets';

interface OverlayDeps {
  store: PatchStore;
  engine: Engine;
  fromLink: boolean;
  onStart(): Promise<void>;
}

/** The one obvious first action: a full-screen "turn the sound on" card. */
export function mountOverlay({ store, engine, fromLink, onStart }: OverlayDeps) {
  const el = document.createElement('div');
  el.className = 'ov';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Start Patchbay');
  const p = store.patch;
  const preset = PRESETS.find((x) => x.name === p.name);
  const hasSeq = p.modules.some((m) => m.type === 'seq');
  const verb = fromLink ? 'Play the shared patch' : hasSeq ? `Start the ${preset?.tag.toLowerCase().replace('rhythmic ', '') ?? 'music'}` : 'Turn on the sound';
  el.innerHTML = `
    <div class="ov-card">
      <div class="ov-mark" aria-hidden="true">
        <svg viewBox="0 0 220 80"><path class="ov-cable" d="M20 62 C 60 -8, 150 -8, 200 40" /><circle cx="20" cy="62" r="11"/><circle cx="200" cy="40" r="11"/></svg>
      </div>
      <h1 class="ov-title">Patchbay</h1>
      <p class="ov-tag">A modular synthesizer you can play right now.</p>
      <button class="ov-go" type="button"><span class="ov-go-icon"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg></span><span class="ov-go-text"><b></b><small></small></span></button>
      <p class="ov-fine">Starts at a gentle volume · <kbd>Esc</kbd> stops all sound</p>
      <div class="ov-alt"><span>or begin with</span><div class="ov-chips"></div></div>
    </div>`;
  (el.querySelector('.ov-go-text b') as HTMLElement).textContent = verb;
  (el.querySelector('.ov-go-text small') as HTMLElement).textContent = p.name;
  const chips = el.querySelector('.ov-chips')!;
  for (const pr of PRESETS) {
    if (pr.name === p.name) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ov-chip';
    b.innerHTML = `<small></small><b></b>`;
    b.querySelector('small')!.textContent = pr.tag;
    b.querySelector('b')!.textContent = pr.name;
    b.onclick = () => go(() => store.load(pr.make()));
    chips.append(b);
  }
  document.body.append(el);
  document.getElementById('app')!.setAttribute('aria-hidden', 'true');
  const btn = el.querySelector('.ov-go') as HTMLButtonElement;
  btn.focus();

  let done = false;
  async function go(before?: () => void) {
    if (done) return;
    done = true;
    before?.();
    el.classList.add('out');
    document.getElementById('app')!.removeAttribute('aria-hidden');
    try {
      await onStart();
    } catch {
      /* engine emits its own error */
    }
    setTimeout(() => el.remove(), 600);
  }
  btn.onclick = () => go();
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      go();
    }
  });
  // If audio somehow starts elsewhere (e.g. a key press), dismiss.
  engine.on((ev) => {
    if (ev.type === 'started' && !done) go();
  });
}
