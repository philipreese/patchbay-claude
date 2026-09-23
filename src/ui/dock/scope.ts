import type { PatchStore } from '../../core/store';
import type { EngineView } from '../../audio/engineApi';
import { getModuleDef } from '../../core/moduleDefs';

/** Live waveform + log-frequency spectrum inspector. */
export function mountScope(container: HTMLElement, store: PatchStore, engine: EngineView): { destroy(): void } {
  container.innerHTML = '';
  container.className = 'dock-scope';

  const head = document.createElement('div');
  head.className = 'scope-head';
  const label = document.createElement('div');
  label.className = 'scope-label';
  const masterBtn = document.createElement('button');
  masterBtn.className = 'scope-master-btn';
  masterBtn.type = 'button';
  masterBtn.textContent = 'Master';
  masterBtn.title = 'Reset the scope to the master output';
  masterBtn.addEventListener('click', () => store.setProbe(null));
  head.appendChild(label);
  head.appendChild(masterBtn);
  container.appendChild(head);

  const waveWrap = document.createElement('div');
  waveWrap.className = 'scope-canvas-wrap';
  const waveTitle = document.createElement('div');
  waveTitle.className = 'scope-title';
  waveTitle.textContent = 'Waveform';
  const waveCanvas = document.createElement('canvas');
  waveCanvas.className = 'scope-canvas';
  waveWrap.appendChild(waveTitle);
  waveWrap.appendChild(waveCanvas);
  container.appendChild(waveWrap);

  const specWrap = document.createElement('div');
  specWrap.className = 'scope-canvas-wrap';
  const specTitle = document.createElement('div');
  specTitle.className = 'scope-title';
  specTitle.textContent = 'Spectrum';
  const specCanvas = document.createElement('canvas');
  specCanvas.className = 'scope-canvas';
  specWrap.appendChild(specTitle);
  specWrap.appendChild(specCanvas);
  container.appendChild(specWrap);

  const helper = document.createElement('div');
  helper.className = 'scope-helper';
  helper.textContent = 'Tap any output jack to inspect it.';
  container.appendChild(helper);

  function updateLabel() {
    const ref = store.probe;
    if (!ref) {
      label.textContent = 'Inspecting: Master output';
      return;
    }
    const mod = store.getModule(ref.module);
    const def = mod ? getModuleDef(mod.type) : undefined;
    const modLabel = mod?.label ?? def?.title ?? ref.module;
    const portLabel = def?.outputs.find((p) => p.id === ref.port)?.label ?? ref.port;
    label.textContent = `Inspecting: ${modLabel} › ${portLabel}`;
  }
  updateLabel();
  const unsub = store.subscribe((ev) => {
    if (ev.type === 'probe') updateLabel();
  });

  function sizeCanvas(c: HTMLCanvasElement) {
    const rect = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return { w, h, dpr };
  }

  function drawOff(c: HTMLCanvasElement, msg: string) {
    const { w, h } = sizeCanvas(c);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(243,238,227,0.03)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(243,238,227,0.35)';
    ctx.font = `${Math.round(h * 0.14)}px var(--font-mono)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
  }

  const timeBuf = new Uint8Array(2048);
  function drawWave(analyser: AnalyserNode) {
    const c = waveCanvas;
    const { w, h } = sizeCanvas(c);
    const ctx = c.getContext('2d')!;
    const n = Math.min(analyser.fftSize, timeBuf.length);
    const buf = timeBuf.subarray(0, n);
    analyser.getByteTimeDomainData(buf);

    // Stable trigger: first rising zero-crossing in the first half of the buffer.
    let trigger = 0;
    const searchEnd = Math.floor(n * 0.5);
    for (let i = 1; i < searchEnd; i++) {
      if (buf[i - 1] < 128 && buf[i] >= 128) {
        trigger = i;
        break;
      }
    }
    const span = Math.floor(n * 0.5); // show half a buffer worth after the trigger
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(243,238,227,0.03)';
    ctx.fillRect(0, 0, w, h);
    // centre line
    ctx.strokeStyle = 'rgba(243,238,227,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'var(--scope-line, #ff8a5c)';
    ctx.lineWidth = Math.max(1.5, h * 0.006);
    ctx.lineJoin = 'round';
    for (let i = 0; i < span; i++) {
      const v = buf[trigger + i] ?? 128;
      const y = h / 2 - ((v - 128) / 128) * (h * 0.46);
      const x = (i / (span - 1)) * w;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const freqBuf = new Uint8Array(2048);
  const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  function freqLabel(f: number) {
    return f >= 1000 ? f / 1000 + 'k' : String(f);
  }
  function drawSpectrum(analyser: AnalyserNode, sampleRate: number) {
    const c = specCanvas;
    const { w, h } = sizeCanvas(c);
    const ctx = c.getContext('2d')!;
    const n = Math.min(analyser.frequencyBinCount, freqBuf.length);
    const buf = freqBuf.subarray(0, n);
    analyser.getByteFrequencyData(buf);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(243,238,227,0.03)';
    ctx.fillRect(0, 0, w, h);

    const fMin = 30;
    const fMax = Math.min(20000, sampleRate / 2);
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    const nyquist = sampleRate / 2;
    const padBottom = Math.max(14, h * 0.12);
    const plotH = h - padBottom;

    // gridlines + labels
    ctx.strokeStyle = 'rgba(243,238,227,0.08)';
    ctx.fillStyle = 'rgba(243,238,227,0.4)';
    ctx.font = `${Math.max(9, Math.round(h * 0.055))}px var(--font-mono)`;
    ctx.textAlign = 'center';
    for (const f of ticks) {
      if (f < fMin || f > fMax) continue;
      const x = ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
      ctx.stroke();
      ctx.fillText(freqLabel(f), Math.min(w - 14, Math.max(14, x)), h - 3);
    }

    // dB gridlines (analyser.minDecibels..maxDecibels)
    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    ctx.textAlign = 'left';
    for (const db of [0, -20, -40, -60, -80]) {
      if (db > maxDb || db < minDb) continue;
      const y = plotH * (1 - (db - minDb) / (maxDb - minDb));
      ctx.strokeStyle = 'rgba(243,238,227,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(243,238,227,0.3)';
      ctx.fillText(db + 'dB', 3, Math.max(9, y - 2));
    }

    // spectrum line/fill, sampled per pixel along the log axis
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const f = Math.pow(10, logMin + (x / w) * (logMax - logMin));
      const bin = Math.min(n - 1, Math.max(0, Math.round((f / nyquist) * n)));
      const mag = buf[bin] / 255;
      const y = plotH * (1 - mag);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, plotH);
    ctx.lineTo(0, plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(61,124,240,0.22)';
    ctx.fill();

    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      const f = Math.pow(10, logMin + (x / w) * (logMax - logMin));
      const bin = Math.min(n - 1, Math.max(0, Math.round((f / nyquist) * n)));
      const mag = buf[bin] / 255;
      const y = plotH * (1 - mag);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#3d7cf0';
    ctx.lineWidth = Math.max(1.2, h * 0.005);
    ctx.stroke();
  }

  let raf = 0;
  let alive = true;
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const analyser = engine.getProbeAnalyser();
    if (!analyser || !engine.ctx) {
      drawOff(waveCanvas, 'Audio is off — press play to start');
      drawOff(specCanvas, 'Audio is off');
      return;
    }
    drawWave(analyser);
    drawSpectrum(analyser, engine.ctx.sampleRate);
  }
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      unsub();
    },
  };
}
