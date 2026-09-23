// AudioWorkletProcessor that captures stereo audio and posts chunks of Float32
// samples back to the main thread. Kept dependency-free (plain JS, no imports)
// so Vite can emit it as a standalone asset served next to the built JS.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this._active = false;
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const left = input[0] ? input[0].slice() : new Float32Array(128);
    const right = input[1] ? input[1].slice() : left.slice();

    this.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
