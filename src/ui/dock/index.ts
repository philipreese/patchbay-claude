import './dock.css';
import type { PatchStore } from '../../core/store';
import type { EngineView } from '../../audio/engineApi';
import { getModuleDef } from '../../core/moduleDefs';
import type { Macro } from '../../core/types';
import { createMacroKnob } from './macroKnob';
import { mountScope } from './scope';
import { mountRhythm } from './rhythm';
import { buildPlaybar } from './playbar';

const CAT_COLOR_VAR: Record<string, string> = {
  play: 'var(--cat-play)',
  source: 'var(--cat-source)',
  shape: 'var(--cat-shape)',
  modulate: 'var(--cat-modulate)',
  effect: 'var(--cat-effect)',
  out: 'var(--cat-out)',
};

function macroColor(macro: Macro, store: PatchStore, index: number): string {
  const target = macro.targets[0];
  const mod = target && store.getModule(target.module);
  const def = mod && getModuleDef(mod.type);
  if (def) return CAT_COLOR_VAR[def.category] ?? `var(--cable-${index % 6})`;
  return `var(--cable-${index % 6})`;
}

const MOBILE_QUERY = '(max-width: 820px)';

export function mountDock(dock: HTMLElement, playbar: HTMLElement, store: PatchStore, engine: EngineView): void {
  dock.innerHTML = '';
  playbar.innerHTML = '';

  // ---------------------------------------------------------------------
  // Desktop dock sections: header, Sound (macros), Scope, Rhythm.
  // ---------------------------------------------------------------------
  const dockScroll = document.createElement('div');
  dockScroll.className = 'dock-scroll';

  const headerSection = document.createElement('div');
  headerSection.className = 'dock-section dock-header';
  const patchName = document.createElement('h1');
  patchName.className = 'dock-patch-name';
  const patchAbout = document.createElement('p');
  patchAbout.className = 'dock-patch-about';
  headerSection.appendChild(patchName);
  headerSection.appendChild(patchAbout);

  function refreshHeader() {
    patchName.textContent = store.patch.name;
    patchAbout.textContent = store.patch.about ?? '';
    patchAbout.style.display = store.patch.about ? '' : 'none';
  }
  refreshHeader();

  const soundSection = document.createElement('div');
  soundSection.className = 'dock-section dock-sound';
  const soundTitle = document.createElement('div');
  soundTitle.className = 'dock-section-title';
  soundTitle.textContent = 'Sound';
  const macroGrid = document.createElement('div');
  macroGrid.className = 'macro-grid';
  soundSection.appendChild(soundTitle);
  soundSection.appendChild(macroGrid);

  let knobs: { refresh(): void }[] = [];
  function buildMacros() {
    macroGrid.innerHTML = '';
    knobs = store.patch.macros.slice(0, 4).map((macro, i) => {
      const knob = createMacroKnob({
        label: macro.label,
        hint: macro.hint,
        color: macroColor(macro, store, i),
        getValue: () => store.getMacro(i),
        onChange: (v) => store.setMacro(i, v),
      });
      macroGrid.appendChild(knob.el);
      return knob;
    });
  }
  buildMacros();

  const scopeSection = document.createElement('div');
  scopeSection.className = 'dock-section dock-scope-section';
  const scopeTitle = document.createElement('div');
  scopeTitle.className = 'dock-section-title';
  scopeTitle.textContent = 'Scope';
  const scopeHost = document.createElement('div');
  scopeSection.appendChild(scopeTitle);
  scopeSection.appendChild(scopeHost);
  mountScope(scopeHost, store, engine);

  const rhythmSection = document.createElement('div');
  rhythmSection.className = 'dock-section dock-rhythm-section';
  const rhythmTitle = document.createElement('div');
  rhythmTitle.className = 'dock-section-title';
  rhythmTitle.textContent = 'Rhythm';
  const rhythmHost = document.createElement('div');
  rhythmSection.appendChild(rhythmTitle);
  rhythmSection.appendChild(rhythmHost);
  const rhythm = mountRhythm(rhythmHost, store, engine);

  let layoutIsMobile = false;
  function refreshRhythmVisibility() {
    if (layoutIsMobile) return; // handled by applyTabDisplay
    rhythmSection.style.display = rhythm.hasSeq() ? '' : 'none';
  }
  refreshRhythmVisibility();

  dockScroll.appendChild(headerSection);
  dockScroll.appendChild(soundSection);
  dockScroll.appendChild(scopeSection);
  dockScroll.appendChild(rhythmSection);

  // ---------------------------------------------------------------------
  // Playbar: keyboard, expression, chords (single instances, reparented
  // into the mobile Play tab when the layout is narrow).
  // ---------------------------------------------------------------------
  const pb = buildPlaybar(engine, store.patch);
  const playbarInner = document.createElement('div');
  playbarInner.className = 'playbar-inner';
  const playRow = document.createElement('div');
  playRow.className = 'playbar-row';
  playRow.appendChild(pb.chordsEl);
  playRow.appendChild(pb.expressionEl);
  playbarInner.appendChild(playRow);
  playbarInner.appendChild(pb.keyboardEl);
  playbar.appendChild(playbarInner);

  // ---------------------------------------------------------------------
  // Mobile tab shell (Play | Sound | Rhythm | Scope).
  // ---------------------------------------------------------------------
  const tabShell = document.createElement('div');
  tabShell.className = 'dock-tabs';
  const tabBar = document.createElement('div');
  tabBar.className = 'dock-tab-bar';
  const playPanel = document.createElement('div');
  playPanel.className = 'dock-tab-panel';
  tabShell.appendChild(tabBar);
  tabShell.appendChild(playPanel);

  type TabId = 'play' | 'sound' | 'rhythm' | 'scope';
  const tabs: { id: TabId; label: string }[] = [
    { id: 'play', label: 'Play' },
    { id: 'sound', label: 'Sound' },
    { id: 'rhythm', label: 'Rhythm' },
    { id: 'scope', label: 'Scope' },
  ];
  let activeTab: TabId = 'play';
  const tabBtns = new Map<TabId, HTMLButtonElement>();
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-tab-btn';
    btn.textContent = t.label;
    btn.addEventListener('click', () => setActiveTab(t.id));
    tabBar.appendChild(btn);
    tabBtns.set(t.id, btn);
  }

  function setActiveTab(id: TabId) {
    activeTab = id;
    tabBtns.forEach((btn, tid) => btn.classList.toggle('is-active', tid === id));
    applyTabDisplay();
  }

  function refreshTabVisibility() {
    tabBtns.get('rhythm')!.style.display = rhythm.hasSeq() ? '' : 'none';
    if (activeTab === 'rhythm' && !rhythm.hasSeq()) setActiveTab('play');
  }

  function layoutMobile() {
    layoutIsMobile = true;
    dock.innerHTML = '';
    dock.appendChild(tabShell);
    playPanel.innerHTML = '';
    playPanel.classList.add('play-tab-panel');
    // The keyboard is the star on phone: it goes first and gets most of the
    // height; the patch name/about is skipped here (the topbar shows it).
    playPanel.appendChild(pb.keyboardEl);
    playPanel.appendChild(pb.chordsEl);
    playPanel.appendChild(pb.expressionEl);

    // Sound / Rhythm / Scope become tab panels appended after Play, shown/hidden via CSS.
    tabShell.appendChild(soundSection);
    tabShell.appendChild(rhythmSection);
    tabShell.appendChild(scopeSection);
    soundSection.classList.add('dock-tab-panel');
    rhythmSection.classList.add('dock-tab-panel');
    scopeSection.classList.add('dock-tab-panel');
    rhythmSection.style.display = '';
    scopeSection.style.display = '';
    soundSection.style.display = '';

    playbar.style.display = 'none';
    applyTabDisplay();
    refreshTabVisibility();
  }

  function applyTabDisplay() {
    playPanel.style.display = activeTab === 'play' ? '' : 'none';
    soundSection.style.display = activeTab === 'sound' ? '' : 'none';
    rhythmSection.style.display = activeTab === 'rhythm' ? (rhythm.hasSeq() ? '' : 'none') : 'none';
    scopeSection.style.display = activeTab === 'scope' ? '' : 'none';
  }

  function layoutDesktop() {
    layoutIsMobile = false;
    dock.innerHTML = '';
    soundSection.classList.remove('dock-tab-panel');
    rhythmSection.classList.remove('dock-tab-panel');
    scopeSection.classList.remove('dock-tab-panel');
    soundSection.style.display = '';
    scopeSection.style.display = '';
    dockScroll.innerHTML = '';
    dockScroll.appendChild(headerSection);
    dockScroll.appendChild(soundSection);
    dockScroll.appendChild(scopeSection);
    dockScroll.appendChild(rhythmSection);
    dock.appendChild(dockScroll);
    refreshRhythmVisibility();

    playbar.style.display = '';
    playbarInner.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'playbar-row';
    row.appendChild(pb.chordsEl);
    row.appendChild(pb.expressionEl);
    playbarInner.appendChild(row);
    playbarInner.appendChild(pb.keyboardEl);
  }

  const mq = window.matchMedia(MOBILE_QUERY);
  function applyLayout() {
    if (mq.matches) layoutMobile();
    else layoutDesktop();
  }
  mq.addEventListener('change', applyLayout);

  setActiveTab('play');
  applyLayout();

  // ---------------------------------------------------------------------
  // Reactivity
  // ---------------------------------------------------------------------
  function refreshChordsProminence() {
    pb.chordsEl.classList.toggle('is-primary', !!store.patch.chords);
    pb.chordsEl.classList.toggle('is-secondary', !store.patch.chords);
  }
  refreshChordsProminence();

  store.subscribe((ev) => {
    if (ev.type === 'meta' || ev.type === 'load') refreshHeader();
    if (ev.type === 'load') {
      buildMacros();
      refreshRhythmVisibility();
      refreshTabVisibility();
      refreshChordsProminence();
    }
    if (ev.type === 'param' || ev.type === 'load') knobs.forEach((k) => k.refresh());
    if (ev.type === 'module-add' || ev.type === 'module-remove') {
      refreshRhythmVisibility();
      refreshTabVisibility();
    }
  });

  // Keep macro knobs live even though the store only reports the params they
  // ultimately touch — cheap enough to refresh on every animation frame too,
  // in case a target param moves via automation/MIDI elsewhere.
  function raf() {
    knobs.forEach((k) => k.refresh());
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
}

/**
 * Lets the lead keep the on-screen keyboard's octave in sync with computer-keyboard
 * (or MIDI) octave changes handled elsewhere. Dispatches the same 'patchbay:octave'
 * event the on-screen octave buttons emit; the playbar keyboard listens for it too.
 */
export function setDockOctave(baseMidi: number): void {
  window.dispatchEvent(new CustomEvent('patchbay:octave', { detail: baseMidi }));
}
