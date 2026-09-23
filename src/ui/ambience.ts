import type { EngineView } from '../audio/engineApi';

/**
 * A soft light layer behind the patch canvas that breathes with the music.
 * Every value comes from the master analyser: low, mid and high band energy
 * drive three coloured glows. Silent audio = dark canvas.
 */
export function mountAmbience(root: HTMLElement, engine: EngineView) {
  const cv = document.createElement('canvas');
  cv.className = 'ambience';
  cv.setAttribute('aria-hidden', 'true');
  root.prepend(cv);
  const g = cv.getContext('2d', { alpha: true })!;
  let bins: Float32Array<ArrayBuffer> | null = null;
  const sm = [0, 0, 0];
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const r = root.getBoundingClientRect();
    // Low resolution is fine: everything is blurred glow.
    cv.width = Math.max(1, Math.round(r.width / 4));
    cv.height = Math.max(1, Math.round(r.height / 4));
  };
  new ResizeObserver(resize).observe(root);
  resize();

  const band = (an: AnalyserNode, lo: number, hi: number) => {
    const hz = an.context.sampleRate / an.fftSize;
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.min(bins!.length - 1, Math.ceil(hi / hz));
    let s = 0;
    for (let i = a; i <= b; i++) s += Math.pow(10, bins![i] / 20);
    return s / (b - a + 1);
  };

  const draw = () => {
    requestAnimationFrame(draw);
    if (document.hidden) return;
    const an = engine.getMasterAnalyser();
    const W = cv.width, H = cv.height;
    let e = [0, 0, 0];
    if (an) {
      if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(new ArrayBuffer(an.frequencyBinCount * 4));
      an.getFloatFrequencyData(bins);
      e = [band(an, 30, 250), band(an, 250, 2000), band(an, 2000, 9000)].map((v, i) => Math.min(1, v * [9, 22, 60][i]));
    }
    for (let i = 0; i < 3; i++) sm[i] += (e[i] - sm[i]) * (e[i] > sm[i] ? 0.35 : 0.06);
    g.clearRect(0, 0, W, H);
    if (reduce) return;
    const t = performance.now() / 1000;
    const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
      if (a < 0.004) return;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${rgb},${a})`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    };
    const R = Math.max(W, H);
    blob(W * (0.18 + 0.04 * Math.sin(t * 0.21)), H * 0.92, R * (0.45 + sm[0] * 0.25), '255,91,54', 0.05 + sm[0] * 0.22);
    blob(W * (0.62 + 0.05 * Math.sin(t * 0.13 + 1)), H * (0.25 + 0.05 * Math.cos(t * 0.17)), R * (0.4 + sm[1] * 0.2), '61,124,240', 0.035 + sm[1] * 0.18);
    blob(W * (0.9 + 0.03 * Math.cos(t * 0.19)), H * 0.7, R * (0.3 + sm[2] * 0.2), '47,181,138', 0.02 + sm[2] * 0.16);
  };
  requestAnimationFrame(draw);
}
