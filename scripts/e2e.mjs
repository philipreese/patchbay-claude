// End-to-end checks against the PRODUCTION build served under a GitHub Pages-style
// subpath. Usage: npm run build && npm run test:e2e [-- --base /patchbay-claude/]
// Requires Playwright's Chromium (set CHROMIUM_PATH to override the executable).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const BASE = argVal('--base', '/patchbay-claude/');
const PORT = +argVal('--port', '4199');
const SHOTS = argVal('--shots', 'test-results');
const ROOT = `http://127.0.0.1:${PORT}${BASE}`;
const EXEC = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

if (!existsSync('dist/index.html')) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve-subpath.mjs', '--dir', 'dist', '--base', BASE, '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const outsideBase = [];
server.stdout.on('data', (d) => {
  for (const line of String(d).split('\n')) if (/^404 /.test(line)) outsideBase.push(line);
});
await new Promise((r) => setTimeout(r, 600));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--autoplay-policy=no-user-gesture-required'] });

/** Sample the master analyser for `ms` and return peak/RMS. */
async function level(page, ms = 1200) {
  return page.evaluate(async (ms) => {
    const an = window.__patchbay.engine.getMasterAnalyser();
    if (!an) return { peak: 0, rms: 0 };
    const buf = new Float32Array(an.fftSize);
    let peak = 0, sum = 0, n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 30));
      an.getFloatTimeDomainData(buf);
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; }
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, n)) };
  }, ms);
}

async function freshPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  return { ctx, page, errors };
}

try {
  // ---------------------------------------------------------------- desktop flow
  {
    const { ctx, page, errors } = await freshPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(ROOT);
    await page.waitForSelector('.ov-go', { timeout: 10000 });
    check('start overlay offers one obvious action', await page.isVisible('.ov-go'), await page.textContent('.ov-go-text b'));
    await page.screenshot({ path: `${SHOTS}/01-overlay.png` });
    const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
    check('bundled fonts load under subpath', fontsOk.some((f) => /Bricolage/.test(f)) && fontsOk.some((f) => /Plex/.test(f)), fontsOk.join(', '));

    await page.click('.ov-go');
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ state: window.__patchbay.engine.ctx?.state, playing: window.__patchbay.engine.playing, name: window.__patchbay.store.patch.name }));
    check('audio starts and bass sequencer plays', st.state === 'running' && st.playing, JSON.stringify(st));
    const bass = await level(page, 1500);
    check('bass is audible on master (numeric)', bass.rms > 0.01 && bass.peak < 1.0, `peak ${bass.peak.toFixed(3)} rms ${bass.rms.toFixed(4)}`);
    await page.screenshot({ path: `${SHOTS}/02-bass-playing.png` });

    // macro / param changes during playback are reflected in the patch and sound
    const before = await page.evaluate(() => window.__patchbay.store.patch.modules.find((m) => m.id === 'flt1').params.cutoff);
    await page.evaluate(() => window.__patchbay.store.setMacro(0, 1));
    const after = await page.evaluate(() => window.__patchbay.store.patch.modules.find((m) => m.id === 'flt1').params.cutoff);
    check('Brightness macro moves the real filter cutoff', after > before * 2, `${before} → ${after}`);

    // edit rhythm while playing
    await page.evaluate(() => {
      const { store } = window.__patchbay;
      const m = store.getModule('seq1');
      const steps = m.data.steps.map((s) => ({ ...s }));
      steps[1].on = true; steps[1].note = 7;
      store.setData('seq1', { steps });
      store.setTempo(132);
    });
    const stepSeen = new Set();
    for (let i = 0; i < 25; i++) {
      stepSeen.add(await page.evaluate(() => window.__patchbay.engine.getCurrentStep('seq1')));
      await page.waitForTimeout(40);
    }
    check('sequencer playhead advances after live edit', stepSeen.size >= 4, [...stepSeen].join(','));

    // inspect a signal
    await page.evaluate(() => window.__patchbay.store.setProbe({ module: 'flt1', port: 'out' }));
    await page.waitForTimeout(300);
    const probe = await page.evaluate(() => {
      const { engine } = window.__patchbay;
      const an = engine.getProbeAnalyser();
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      return { isMaster: an === engine.getMasterAnalyser(), peak: Math.max(...buf.map(Math.abs)) };
    });
    // The probed signal must differ from master: probe the pitch CV (a slow DC-ish signal).
    const probe2 = await page.evaluate(async () => {
      const { store, engine } = window.__patchbay;
      store.setProbe({ module: 'seq1', port: 'pitch' });
      await new Promise((r) => setTimeout(r, 200));
      const buf = new Float32Array(2048);
      engine.getProbeAnalyser().getFloatTimeDomainData(buf);
      const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
      const label = document.querySelector('#dock')?.textContent || '';
      store.setProbe({ module: 'flt1', port: 'out' });
      return { mean, labelled: /Bass line|Sequencer/.test(label) && /Pitch/.test(label) };
    });
    check('probe analyser switches to the selected port', !probe.isMaster && probe.peak > 0.01 && Math.abs(probe2.mean) > 0.3 && probe2.labelled, JSON.stringify({ ...probe, ...probe2 }));

    // change a connection during playback: pull the cable into Output, sound should stop
    const cut = await page.evaluate(async () => {
      const { store } = window.__patchbay;
      const c = store.patch.cables.find((c) => c.to.module === 'out');
      store.removeCable(c.id);
      return c;
    });
    // The analyser holds the last ~46 ms of pre-unplug audio; let it clear first.
    await page.waitForTimeout(150);
    const silent = await level(page, 700);
    await page.evaluate((c) => window.__patchbay.store.connect(c.from, c.to), cut);
    const back = await level(page, 900);
    check('cables really route audio (unplug → silence, replug → sound)', silent.rms < 0.001 && back.rms > 0.01, `unplugged rms ${silent.rms.toFixed(4)}, replugged ${back.rms.toFixed(4)}`);

    // unsupported connection is refused gracefully
    const bad = await page.evaluate(() => window.__patchbay.store.connect({ module: 'seq1', port: 'gate' }, { module: 'flt1', port: 'in' }));
    check('unsupported connection refused with a reason', bad.ok === false && /gate|note events/i.test(bad.reason), bad.reason);

    // pad chords
    await page.evaluate(() => window.__patchbay.loadPatch(window.__patchbay.presets[1].make()));
    await page.waitForTimeout(400);
    await page.evaluate(() => [60, 64, 67].forEach((n) => window.__patchbay.engine.noteOn(n, 0.8)));
    const chord = await level(page, 1600);
    const voices = await page.evaluate(() => window.__patchbay.engine.getVoices('osc1'));
    check('pad plays a chord (polyphonic voices)', chord.rms > 0.01 && voices >= 3, `voices ${voices}, rms ${chord.rms.toFixed(4)}`);
    await page.evaluate(() => [60, 64, 67].forEach((n) => window.__patchbay.engine.noteOff(n)));

    // record a clip
    await page.evaluate(() => window.__patchbay.engine.noteOn(62, 0.8));
    const rec = await page.evaluate(async () => {
      const { engine } = window.__patchbay;
      await engine.startRecording();
      await new Promise((r) => setTimeout(r, 1500));
      const blob = await engine.stopRecording();
      const buf = new Uint8Array(await blob.arrayBuffer());
      const txt = (a, b) => String.fromCharCode(...buf.slice(a, b));
      const dv = new DataView(buf.buffer);
      // measure recorded audio energy
      let sum = 0; const n = (buf.length - 44) / 2;
      for (let i = 44; i + 1 < buf.length; i += 2) { const s = dv.getInt16(i, true) / 32768; sum += s * s; }
      return { type: blob.type, size: blob.size, riff: txt(0, 4), wave: txt(8, 12), rate: dv.getUint32(24, true), ch: dv.getUint16(22, true), rms: Math.sqrt(sum / n) };
    });
    await page.evaluate(() => window.__patchbay.engine.noteOff(62));
    check('recording produces a playable WAV with sound', rec.riff === 'RIFF' && rec.wave === 'WAVE' && rec.size > 50000 && rec.rms > 0.005, JSON.stringify(rec));
    const playable = await page.evaluate(async () => {
      const { engine } = window.__patchbay;
      await engine.startRecording(); await new Promise((r) => setTimeout(r, 400));
      const blob = await engine.stopRecording();
      const a = new Audio(URL.createObjectURL(blob));
      return await new Promise((res) => { a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); });
    });
    check('recorded clip decodes in an <audio> element', playable > 0.2, `duration ${playable}`);

    // panic
    await page.evaluate(() => window.__patchbay.loadPatch(window.__patchbay.presets[0].make(), { autoplay: true }));
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__patchbay.engine.panic());
    await page.waitForTimeout(400);
    const quiet = await level(page, 600);
    check('Stop/panic silences everything including echoes', quiet.peak < 0.002, `peak ${quiet.peak.toFixed(5)}`);

    // switch preset cleanly after stop
    await page.evaluate(() => window.__patchbay.loadPatch(window.__patchbay.presets[3].make(), { autoplay: true }));
    await page.waitForTimeout(3500);
    const amb = await level(page, 2500);
    check('generative ambient plays by itself after switching', amb.rms > 0.004, `rms ${amb.rms.toFixed(4)}`);

    // share link round trip (built URL keeps the subpath)
    const share = await page.evaluate(async () => {
      const { store } = window.__patchbay;
      store.setParam('flt2', 'cutoff', 777);
      await new Promise((r) => setTimeout(r, 50));
      return { name: store.patch.name };
    });
    const shareUrl = await page.evaluate(() => window.__patchbay.shareUrl());
    check('share URL preserves deployment subpath and uses #fragment', shareUrl.startsWith(ROOT + '#p='), shareUrl.slice(0, 80) + '…');
    const { ctx: c2, page: p2, errors: e2 } = await freshPage({ viewport: { width: 1280, height: 800 } });
    await p2.goto(shareUrl);
    await p2.waitForSelector('.ov-go');
    const got = await p2.evaluate(() => ({ name: window.__patchbay.store.patch.name, cutoff: window.__patchbay.store.getModule('flt2')?.params.cutoff, n: window.__patchbay.store.patch.modules.length }));
    check('shared link reconstructs the patch in a fresh browser', got.cutoff === 777 && got.name === share.name, JSON.stringify(got));
    check('no page errors on shared-link load', e2.length === 0, e2.join(' | '));
    await c2.close();

    // local save + reload
    await page.evaluate(() => { const { store } = window.__patchbay; store.setName('My Test Patch'); store.setParam('rev1', 'mix', 0.91); });
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForSelector('.ov-go');
    const restored = await page.evaluate(() => ({ name: window.__patchbay.store.patch.name, mix: window.__patchbay.store.getModule('rev1')?.params.mix }));
    check('modified patch survives a reload (autosave)', restored.name === 'My Test Patch' && restored.mix === 0.91, JSON.stringify(restored));
    check('no page errors in desktop flow', errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- numeric DSP checks
  {
    const { ctx, page, errors } = await freshPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(ROOT);
    await page.waitForSelector('.ov-go');
    await page.click('.ov-go');
    await page.waitForTimeout(500);
    const dsp = await page.evaluate(async () => {
      const { store, engine, loadPatch } = window.__patchbay;
      const mk = (mods, cables) => ({ format: 'patchbay', version: 1, name: 'Test', tempo: 120, macros: [], modules: mods, cables });
      const P = (type, id, params = {}) => ({ id, type, x: 0, y: 0, params });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const peakHz = () => {
        const an = engine.getMasterAnalyser();
        const f = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(f);
        let bi = 0; for (let i = 1; i < f.length; i++) if (f[i] > f[bi]) bi = i;
        return (bi * engine.ctx.sampleRate) / an.fftSize;
      };
      const band = (lo, hi) => {
        const an = engine.getMasterAnalyser();
        const f = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(f);
        const hz = engine.ctx.sampleRate / an.fftSize;
        let s = 0, n = 0;
        for (let i = Math.floor(lo / hz); i < Math.min(f.length, hi / hz); i++) { s += Math.pow(10, f[i] / 10); n++; }
        return 10 * Math.log10(s / Math.max(1, n));
      };
      const { parsePatch } = window.__patchbay;
      // Sine through a VCA held open: pitch CV must give A4 = 440 Hz, A3 = 220 Hz.
      loadPatch(mk([P('keys', 'k', { voices: 1 }), P('osc', 'o', { wave: 'sine' }), P('vca', 'v', { gain: 1 }), P('output', 'out', { level: 0.5 })],
        [{ id: 'a', from: { module: 'k', port: 'pitch' }, to: { module: 'o', port: 'pitch' } }, { id: 'b', from: { module: 'o', port: 'out' }, to: { module: 'v', port: 'in' } }, { id: 'c', from: { module: 'v', port: 'out' }, to: { module: 'out', port: 'in' } }]));
      await wait(400);
      engine.noteOn(69, 1); await wait(500); const a4 = peakHz(); engine.noteOff(69);
      engine.noteOn(57, 1); await wait(500); const a3 = peakHz(); engine.noteOff(57);
      // White noise through a 500 Hz lowpass: energy well above cutoff must be far lower.
      loadPatch(mk([P('noise', 'n', { color: 'white' }), P('filter', 'f', { mode: 'lowpass', cutoff: 500, res: 0.7 }), P('output', 'out', { level: 0.5 })],
        [{ id: 'a', from: { module: 'n', port: 'out' }, to: { module: 'f', port: 'in' } }, { id: 'b', from: { module: 'f', port: 'out' }, to: { module: 'out', port: 'in' } }]));
      await wait(700);
      const low = band(100, 400), high = band(6000, 12000);
      return { a4, a3, low, high, sr: engine.ctx.sampleRate };
    });
    const bin = dsp.sr / 2048;
    check('numeric: pitch CV tracks 1V/oct (A4≈440 Hz, A3≈220 Hz)', Math.abs(dsp.a4 - 440) <= bin * 1.5 && Math.abs(dsp.a3 - 220) <= bin * 1.5, `A4 ${dsp.a4.toFixed(1)} Hz, A3 ${dsp.a3.toFixed(1)} Hz (bin ${bin.toFixed(1)} Hz)`);
    check('numeric: lowpass filter attenuates highs', dsp.low - dsp.high > 30, `100–400 Hz ${dsp.low.toFixed(1)} dB vs 6–12 kHz ${dsp.high.toFixed(1)} dB`);
    check('no page errors in DSP checks', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---------------------------------------------------------------- malformed links
  {
    const { ctx, page, errors } = await freshPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(ROOT + '#p=this-is-not-a-patch!!');
    await page.waitForSelector('.ov-go');
    const name = await page.evaluate(() => window.__patchbay.store.patch.name);
    check('malformed share link falls back to a starter without crashing', !!name && errors.length === 0, `${name}; errors: ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---------------------------------------------------------------- phone
  {
    const { ctx, page, errors } = await freshPage({ ...devices['iPhone 13'], browserName: undefined, defaultBrowserType: undefined });
    await page.goto(ROOT);
    await page.waitForSelector('.ov-go');
    await page.screenshot({ path: `${SHOTS}/10-phone-overlay.png` });
    await page.tap('.ov-go');
    await page.waitForTimeout(1200);
    // #app is position:fixed with overflow hidden, so document scroll width can't reveal
    // clipping; check the app box and that every top-bar control is fully on screen.
    const fit = await page.evaluate(() => {
      const W = window.innerWidth;
      const app = document.getElementById('app');
      const offscreen = [...document.querySelectorAll('#topbar button, .dock-tab-bar button, .canvas-overlay-add')]
        .filter((b) => b.offsetParent && b.getBoundingClientRect().right > W + 1).map((b) => b.getAttribute('aria-label') || b.textContent.trim());
      return { W, app: app.scrollWidth, offscreen };
    });
    check('phone: app fits the screen width, no clipped controls', fit.app <= fit.W + 1 && fit.offscreen.length === 0, JSON.stringify(fit));
    await page.screenshot({ path: `${SHOTS}/11-phone-playing.png` });
    const ph = await level(page, 1000);
    check('phone: sound plays after tap', ph.rms > 0.005, `rms ${ph.rms.toFixed(4)}`);
    check('no page errors on phone', errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  check('no requests fell outside the deployment subpath', outsideBase.length === 0, outsideBase.join(' | '));
} catch (e) {
  check('e2e run completed', false, e?.stack || String(e));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
