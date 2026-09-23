import { describe, expect, it } from 'vitest';
import { encodeWav } from '../../src/audio/wav';

function readStr(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWav', () => {
  it('writes a correct RIFF/WAVE header for stereo', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const right = new Float32Array([0, -0.5, 0.5, -1, 1]);
    const buf = encodeWav([left, right], 44100);
    const view = new DataView(buf);

    expect(readStr(view, 0, 4)).toBe('RIFF');
    expect(readStr(view, 8, 4)).toBe('WAVE');
    expect(readStr(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    const blockAlign = 2 * 2;
    expect(view.getUint32(28, true)).toBe(44100 * blockAlign); // byte rate
    expect(view.getUint16(32, true)).toBe(blockAlign);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readStr(view, 36, 4)).toBe('data');

    const dataSize = left.length * blockAlign;
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(buf.byteLength).toBe(44 + dataSize);
  });

  it('produces the correct total byte length for mono', () => {
    const mono = new Float32Array(1000);
    const buf = encodeWav([mono], 48000);
    expect(buf.byteLength).toBe(44 + 1000 * 2);
    const view = new DataView(buf);
    expect(view.getUint16(22, true)).toBe(1);
  });

  it('clamps samples outside -1..1 and handles NaN/Infinity safely', () => {
    const left = new Float32Array([2, -2, NaN, Infinity, -Infinity, 0.999999]);
    const buf = encodeWav([left], 44100);
    const view = new DataView(buf);
    const s0 = view.getInt16(44 + 0 * 2, true);
    const s1 = view.getInt16(44 + 1 * 2, true);
    const s2 = view.getInt16(44 + 2 * 2, true);
    const s3 = view.getInt16(44 + 3 * 2, true);
    const s4 = view.getInt16(44 + 4 * 2, true);
    expect(s0).toBe(0x7fff); // clamped +1
    expect(s1).toBe(-0x8000); // clamped -1
    expect(s2).toBe(0); // NaN -> 0
    expect(s3).toBe(0x7fff); // +Infinity -> clamped +1
    expect(s4).toBe(-0x8000); // -Infinity -> clamped -1
  });

  it('interleaves left/right samples correctly', () => {
    const left = new Float32Array([1, -1]);
    const right = new Float32Array([-1, 1]);
    const buf = encodeWav([left, right], 44100);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff); // L0
    expect(view.getInt16(46, true)).toBe(-0x8000); // R0
    expect(view.getInt16(48, true)).toBe(-0x8000); // L1
    expect(view.getInt16(50, true)).toBe(0x7fff); // R1
  });

  it('handles zero-length input without throwing', () => {
    expect(() => encodeWav([], 44100)).not.toThrow();
    const buf = encodeWav([], 44100);
    expect(buf.byteLength).toBe(44);
  });
});
