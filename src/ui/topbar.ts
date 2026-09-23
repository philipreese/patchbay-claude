import './topbar.css';
import type { PatchStore } from '../core/store';
import type { Engine } from '../audio/engine';
import { PRESETS } from '../presets';
import { toast } from './toast';
import { listSaved, savePatch, loadSaved, deleteSaved } from '../core/library';
import { buildShareUrl } from '../core/share';
import { exportPatchFile, pickPatchFile, downloadBlob } from '../core/files';
import { parsePatch } from '../core/serialize';
import type { Patch } from '../core/types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) (el as any)[k] = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null) el.append(k);
  return el;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4.2" height="15" rx="1" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor"/></svg>',
  rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function iconBtn(icon: string, label: string, cls = ''): HTMLButtonElement {
  const b = h('button', { class: `tb-btn ${cls}`, type: 'button', 'aria-label': label, title: label });
  b.innerHTML = icon;
  return b;
}

export interface TopbarDeps {
  store: PatchStore;
  engine: Engine;
  /** Load a patch (already validated) as the current instrument. */
  loadPatch(p: Patch, opts?: { autoplay?: boolean }): void;
  ensureStarted(): Promise<void>;
}

export function mountTopbar(root: HTMLElement, deps: TopbarDeps) {
  const { store, engine } = deps;

  // ---- brand + preset picker
  const brand = h('div', { class: 'tb-brand' });
  brand.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 46 C 20 8, 44 8, 52 26" fill="none" stroke="var(--hot)" stroke-width="7" stroke-linecap="round"/><circle cx="12" cy="46" r="7.5" fill="var(--brass)"/><circle cx="52" cy="26" r="7.5" fill="var(--brass)"/></svg><span>Patchbay</span>`;

  const presetBtn = h('button', { class: 'tb-preset', type: 'button', 'aria-haspopup': 'menu', title: 'Choose an instrument' });
  const presetName = h('span', { class: 'tb-preset-name' });
  const presetTag = h('span', { class: 'tb-preset-tag' }, 'Instrument');
  presetBtn.append(h('span', { class: 'tb-preset-text' }, presetTag, presetName));
  presetBtn.insertAdjacentHTML('beforeend', ICON.chev);

  // ---- transport
  const playBtn = iconBtn(ICON.play, 'Play sequencer (Space)', 'tb-play');
  const stopBtn = iconBtn(ICON.stop, 'Stop all sound (Esc)', 'tb-stop');
  stopBtn.insertAdjacentHTML('beforeend', '<span class="tb-btn-label">Stop</span>');

  const tempo = h('div', { class: 'tb-tempo', title: 'Tempo — drag or use the arrows' });
  const tDown = h('button', { class: 'tb-mini', type: 'button', 'aria-label': 'Slower' }, '−');
  const tVal = h('div', { class: 'tb-tempo-val', role: 'spinbutton', tabindex: '0', 'aria-label': 'Tempo in BPM' });
  const tUp = h('button', { class: 'tb-mini', type: 'button', 'aria-label': 'Faster' }, '+');
  tempo.append(tDown, tVal, tUp);

  // ---- volume
  const vol = h('div', { class: 'tb-vol', title: 'Master volume' });
  vol.insertAdjacentHTML('afterbegin', ICON.vol);
  const volRange = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Master volume' }) as HTMLInputElement;
  const volMeter = h('div', { class: 'tb-vol-meter' });
  const volTrack = h('div', { class: 'tb-vol-track' }, volMeter, volRange);
  vol.append(volTrack);

  // ---- record / save / share / more
  const recBtn = iconBtn(ICON.rec, 'Record a clip', 'tb-rec');
  const recTime = h('span', { class: 'tb-btn-label' }, 'Rec');
  recBtn.append(recTime);
  const saveBtn = iconBtn(ICON.save, 'Save to this browser', 'tb-save');
  saveBtn.insertAdjacentHTML('beforeend', '<span class="tb-btn-label">Save</span>');
  const shareBtn = iconBtn(ICON.share, 'Copy a share link', 'tb-share');
  shareBtn.insertAdjacentHTML('beforeend', '<span class="tb-btn-label">Share</span>');
  const moreBtn = iconBtn(ICON.more, 'More', 'tb-more');

  const left = h('div', { class: 'tb-left' }, brand, presetBtn);
  const mid = h('div', { class: 'tb-mid' }, playBtn, stopBtn, tempo);
  const right = h('div', { class: 'tb-right' }, vol, recBtn, saveBtn, shareBtn, moreBtn);
  root.append(left, mid, right);

  // ------------------------------------------------------------ popover helper
  let openPop: HTMLElement | null = null;
  function closePop() {
    openPop?.remove();
    openPop = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e: Event) {
    if (openPop && !openPop.contains(e.target as Node)) closePop();
  }
  function popover(anchor: HTMLElement, content: HTMLElement, align: 'left' | 'right' = 'left') {
    closePop();
    const pop = h('div', { class: 'tb-pop', role: 'menu' }, content);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.top = r.bottom + 8 + 'px';
    let x = align === 'left' ? r.left : r.right - w;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    pop.style.left = x + 'px';
    pop.style.maxHeight = window.innerHeight - r.bottom - 24 + 'px';
    openPop = pop;
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePop();
        anchor.focus();
      }
    });
    (pop.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ presets
  function presetMenu() {
    const box = h('div', { class: 'pm' });
    box.append(h('div', { class: 'pm-head' }, 'Starter instruments'));
    for (const p of PRESETS) {
      const b = h('button', { class: 'pm-item', type: 'button', role: 'menuitem' }, h('span', { class: 'pm-tag' }, p.tag), h('span', { class: 'pm-name' }, p.name));
      b.onclick = () => {
        closePop();
        deps.loadPatch(p.make(), { autoplay: true });
      };
      box.append(b);
    }
    const saved = listSaved();
    box.append(h('div', { class: 'pm-head' }, saved.length ? 'Saved in this browser' : 'Saved in this browser — none yet'));
    for (const s of saved) {
      const row = h('div', { class: 'pm-row' });
      const b = h('button', { class: 'pm-item', type: 'button', role: 'menuitem' }, h('span', { class: 'pm-tag' }, new Date(s.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('span', { class: 'pm-name' }, s.name));
      b.onclick = () => {
        closePop();
        const p = loadSaved(s.id);
        if (p) deps.loadPatch(p, { autoplay: true });
        else toast('That saved patch could not be read.', 'warn');
      };
      const del = h('button', { class: 'pm-del', type: 'button', 'aria-label': `Delete ${s.name}`, title: 'Delete' }, '×');
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${s.name}” from this browser?`)) return;
        deleteSaved(s.id);
        presetMenu();
      };
      row.append(b, del);
      box.append(row);
    }
    popover(presetBtn, box, 'left');
  }
  presetBtn.onclick = () => (openPop ? closePop() : presetMenu());

  // ------------------------------------------------------------ transport
  playBtn.onclick = async () => {
    await deps.ensureStarted();
    engine.togglePlay();
    if (engine.playing && !store.patch.modules.some((m) => m.type === 'seq')) toast('This patch has no sequencer — play it with the keys below.', 'info');
  };
  stopBtn.onclick = () => {
    engine.panic();
    toast('All sound stopped.', 'info', 1400);
  };
  const renderPlay = () => {
    playBtn.innerHTML = engine.playing ? ICON.pause : ICON.play;
    playBtn.classList.toggle('on', engine.playing);
    playBtn.setAttribute('aria-label', engine.playing ? 'Pause sequencer (Space)' : 'Play sequencer (Space)');
    playBtn.title = playBtn.getAttribute('aria-label')!;
  };

  // tempo
  const renderTempo = () => (tVal.innerHTML = `<b>${store.patch.tempo}</b><small>BPM</small>`);
  tDown.onclick = () => store.setTempo(store.patch.tempo - 1);
  tUp.onclick = () => store.setTempo(store.patch.tempo + 1);
  tVal.onkeydown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') store.setTempo(store.patch.tempo + (e.shiftKey ? 10 : 1));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') store.setTempo(store.patch.tempo - (e.shiftKey ? 10 : 1));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  tVal.onpointerdown = (e) => {
    const y0 = e.clientY;
    const x0 = e.clientX;
    const t0 = store.patch.tempo;
    tVal.setPointerCapture(e.pointerId);
    tVal.classList.add('drag');
    const move = (ev: PointerEvent) => store.setTempo(t0 + Math.round((y0 - ev.clientY) / 3 + (ev.clientX - x0) / 3));
    const up = () => {
      tVal.classList.remove('drag');
      tVal.removeEventListener('pointermove', move);
      tVal.removeEventListener('pointerup', up);
      tVal.removeEventListener('pointercancel', up);
    };
    tVal.addEventListener('pointermove', move);
    tVal.addEventListener('pointerup', up);
    tVal.addEventListener('pointercancel', up);
  };
  tVal.onwheel = (e) => {
    e.preventDefault();
    store.setTempo(store.patch.tempo + (e.deltaY < 0 ? 1 : -1));
  };

  // volume
  volRange.value = String(Math.round(engine.masterVolume * 100));
  volRange.oninput = () => engine.setMasterVolume(+volRange.value / 100);
  const renderVol = () => {
    volRange.value = String(Math.round(engine.masterVolume * 100));
    volTrack.style.setProperty('--v', String(engine.masterVolume));
    volRange.setAttribute('aria-valuetext', `${Math.round(engine.masterVolume * 100)}%`);
  };

  // ------------------------------------------------------------ record
  let recTimer: ReturnType<typeof setInterval> | null = null;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  recBtn.onclick = async () => {
    if (!engine.recording) {
      try {
        await deps.ensureStarted();
        await engine.startRecording();
      } catch (e: any) {
        toast(e?.message || 'Recording is not available in this browser.', 'warn');
        return;
      }
      recBtn.classList.add('on');
      recBtn.setAttribute('aria-label', 'Stop recording');
      recBtn.title = 'Stop recording';
      recTime.textContent = '0:00';
      recTimer = setInterval(() => {
        recTime.textContent = fmtTime(engine.recordSeconds);
        if (!engine.recording) finishRec();
      }, 250);
      toast('Recording… press again to stop.', 'info', 1800);
    } else finishRec();
  };
  async function finishRec() {
    if (recTimer) clearInterval(recTimer);
    recTimer = null;
    recBtn.classList.remove('on');
    recBtn.setAttribute('aria-label', 'Record a clip');
    recBtn.title = 'Record a clip';
    recTime.textContent = 'Rec';
    const blob = await engine.stopRecording();
    if (!blob || blob.size < 100) {
      toast('Nothing was recorded.', 'warn');
      return;
    }
    showClip(blob);
  }

  function showClip(blob: Blob) {
    const ext = blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const slug = store.patch.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patch';
    const filename = `patchbay-${slug}-${stamp}.${ext}`;
    const url = URL.createObjectURL(blob);
    const dlg = h('dialog', { class: 'clip-dlg' });
    const audio = h('audio', { controls: true, src: url, preload: 'auto' });
    const dl = h('button', { class: 'dlg-primary', type: 'button' }, `Download .${ext}`);
    dl.onclick = () => downloadBlob(blob, filename);
    const buttons = h('div', { class: 'dlg-actions' }, dl);
    const file = typeof File !== 'undefined' ? new File([blob], filename, { type: blob.type }) : null;
    if (file && (navigator as any).canShare?.({ files: [file] })) {
      const sh = h('button', { class: 'dlg-secondary', type: 'button' }, 'Share…');
      sh.onclick = () => navigator.share({ files: [file], title: filename }).catch(() => {});
      buttons.append(sh);
    }
    const close = h('button', { class: 'dlg-secondary', type: 'button' }, 'Close');
    close.onclick = () => dlg.close();
    buttons.append(close);
    const kb = (blob.size / 1024 / 1024).toFixed(1);
    dlg.append(h('h2', {}, 'Your clip'), h('p', { class: 'dlg-sub' }, `${filename} · ${kb} MB`), audio, buttons);
    dlg.addEventListener('close', () => {
      dlg.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
    document.body.append(dlg);
    dlg.showModal();
  }

  // ------------------------------------------------------------ save / share / more
  function openSave(anchor: HTMLElement) {
    const box = h('div', { class: 'pm' });
    const input = h('input', { class: 'pm-input', type: 'text', value: store.patch.name, maxlength: '48', 'aria-label': 'Patch name' }) as HTMLInputElement;
    const go = h('button', { class: 'dlg-primary', type: 'submit' }, 'Save');
    const form = h('form', { class: 'pm-form' }, input, go);
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim() || 'Untitled';
      store.setName(name);
      const r = savePatch(store.patch, name);
      closePop();
      if (r.ok) toast(`Saved “${name}” in this browser. Find it in the instrument menu.`, 'ok');
      else toast(r.error || 'Could not save (storage full or blocked).', 'warn');
    };
    box.append(h('div', { class: 'pm-head' }, 'Save to this browser'), form, h('p', { class: 'pm-note' }, 'Your current patch is also kept automatically and restored next time you open Patchbay.'));
    popover(anchor, box, 'right');
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
  saveBtn.onclick = () => openSave(saveBtn);

  async function openShare(anchor: HTMLElement) {
    const url = buildShareUrl(store.patch);
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      /* clipboard blocked */
    }
    const box = h('div', { class: 'pm' });
    const field = h('input', { class: 'pm-input', type: 'text', value: url, readonly: true, 'aria-label': 'Share link' }) as HTMLInputElement;
    field.onfocus = () => field.select();
    const actions = h('div', { class: 'dlg-actions' });
    const copy = h('button', { class: 'dlg-primary', type: 'button' }, copied ? 'Copied ✓' : 'Copy link');
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Copied ✓';
      } catch {
        field.focus();
        field.select();
        document.execCommand?.('copy');
        copy.textContent = 'Selected — copy it';
      }
    };
    actions.append(copy);
    if (typeof navigator.share === 'function') {
      const sh = h('button', { class: 'dlg-secondary', type: 'button' }, 'Share…');
      sh.onclick = () => navigator.share({ title: `Patchbay — ${store.patch.name}`, url }).catch(() => {});
      actions.append(sh);
    }
    box.append(
      h('div', { class: 'pm-head' }, 'Share this instrument'),
      h('p', { class: 'pm-note' }, `Anyone opening this link gets this exact patch — modules, cables, knobs and sequence. (${url.length.toLocaleString()} characters)`),
      field,
      actions,
    );
    popover(anchor, box, 'right');
  }
  shareBtn.onclick = () => openShare(shareBtn);

  const midiLine = h('div', { class: 'pm-note' }, 'MIDI: not connected');
  engine.on((ev) => {
    if (ev.type === 'midi') midiLine.textContent = ev.status === 'ready' ? `MIDI: ${ev.inputs.length ? ev.inputs.join(', ') : 'ready — no devices'}` : ev.status === 'denied' ? 'MIDI: permission denied' : 'MIDI: not supported in this browser';
  });

  moreBtn.onclick = () => {
    const box = h('div', { class: 'pm' });
    const item = (label: string, fn: () => void) => {
      const b = h('button', { class: 'pm-item pm-simple', type: 'button', role: 'menuitem' }, label);
      b.onclick = () => {
        closePop();
        fn();
      };
      return b;
    };
    const volRow = h('div', { class: 'pm-vol tb-vol' });
    volRow.insertAdjacentHTML('afterbegin', ICON.vol);
    const vr = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(engine.masterVolume * 100)), 'aria-label': 'Master volume' }) as HTMLInputElement;
    const vt = h('div', { class: 'tb-vol-track' }, vr);
    vt.style.setProperty('--v', String(engine.masterVolume));
    vr.oninput = () => {
      engine.setMasterVolume(+vr.value / 100);
      vt.style.setProperty('--v', String(engine.masterVolume));
    };
    volRow.append(vt);
    const shareItem = h('button', { class: 'pm-item pm-simple', type: 'button', role: 'menuitem' }, 'Share link…');
    shareItem.onclick = () => openShare(moreBtn);
    const saveItem = h('button', { class: 'pm-item pm-simple', type: 'button', role: 'menuitem' }, 'Save to this browser…');
    saveItem.onclick = () => openSave(moreBtn);
    box.append(
      h('div', { class: 'pm-head' }, 'Master volume'),
      volRow,
      h('div', { class: 'pm-head' }, 'Keep & share'),
      saveItem,
      shareItem,
      h('div', { class: 'pm-head' }, 'Patch file'),
      item('Export patch as JSON…', () => exportPatchFile(store.patch)),
      item('Import patch from JSON…', async () => {
        try {
          const text = await pickPatchFile();
          if (text == null) return;
          const r = parsePatch(text);
          if (!r.patch) {
            toast(r.error || 'That file is not a Patchbay patch.', 'warn');
            return;
          }
          deps.loadPatch(r.patch, { autoplay: true });
          if (r.warnings.length) toast(r.warnings.slice(0, 2).join(' '), 'warn', 5000);
        } catch (e: any) {
          toast(e?.message || 'Could not read that file.', 'warn');
        }
      }),
      h('div', { class: 'pm-head' }, 'Playing'),
      h('div', { class: 'pm-note' }, 'Keys A–; play notes (W E T Y U O P are sharps). Z / X change octave. Space plays/pauses. Esc stops all sound.'),
      midiLine,
    );
    popover(moreBtn, box, 'right');
  };

  // ------------------------------------------------------------ meter + state
  const meterBuf = new Float32Array(new ArrayBuffer(2048 * 4));
  let lvl = 0;
  const meterLoop = () => {
    const an = engine.getMasterAnalyser();
    if (an) {
      an.getFloatTimeDomainData(meterBuf);
      let peak = 0;
      for (let i = 0; i < meterBuf.length; i += 2) peak = Math.max(peak, Math.abs(meterBuf[i]));
      lvl = peak > lvl ? peak : lvl * 0.9;
      volMeter.style.transform = `scaleX(${Math.min(1, lvl).toFixed(3)})`;
      volMeter.classList.toggle('hot', lvl > 0.95);
    }
    requestAnimationFrame(meterLoop);
  };
  requestAnimationFrame(meterLoop);

  const renderName = () => {
    presetName.textContent = store.patch.name;
    document.title = `${store.patch.name} — Patchbay`;
  };
  store.subscribe((ev) => {
    if (ev.type === 'load' || ev.type === 'meta') renderName();
    if (ev.type === 'load' || ev.type === 'tempo') renderTempo();
  });
  engine.on((ev) => {
    if (ev.type === 'transport') renderPlay();
    if (ev.type === 'volume') renderVol();
  });
  renderName();
  renderTempo();
  renderPlay();
  renderVol();
}
