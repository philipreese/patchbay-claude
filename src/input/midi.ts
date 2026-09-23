import type { EngineView } from '../audio/engineApi';

export interface MidiStatus {
  status: 'unsupported' | 'denied' | 'ready';
  inputs: string[];
}

/**
 * Wires up Web MIDI (when available) to the engine: note on/off, mod wheel
 * (CC1), all-notes-off (CC123), and pitch bend. Reports status changes
 * (including hot-plug) via `onStatus`. Never throws.
 */
export async function attachMidi(engine: EngineView, onStatus: (s: MidiStatus) => void): Promise<void> {
  const nav = navigator as Navigator & { requestMIDIAccess?: (opts?: any) => Promise<any> };
  if (typeof nav.requestMIDIAccess !== 'function') {
    onStatus({ status: 'unsupported', inputs: [] });
    return;
  }

  let access: any;
  try {
    access = await nav.requestMIDIAccess({ sysex: false });
  } catch {
    onStatus({ status: 'denied', inputs: [] });
    return;
  }

  const attached = new Set<any>();

  function inputNames(): string[] {
    const names: string[] = [];
    try {
      access.inputs.forEach((input: any) => {
        names.push(input.name || 'MIDI device');
      });
    } catch {
      /* ignore */
    }
    return names;
  }

  function reportReady() {
    onStatus({ status: 'ready', inputs: inputNames() });
  }

  function handleMessage(e: any) {
    try {
      const data: Uint8Array = e.data;
      if (!data || data.length < 1) return;
      const status = data[0] & 0xf0;
      const d1 = data[1] ?? 0;
      const d2 = data[2] ?? 0;

      if (status === 0x90) {
        // Note on; velocity 0 means note off.
        if (d2 === 0) engine.noteOff(d1);
        else engine.noteOn(d1, d2 / 127);
      } else if (status === 0x80) {
        engine.noteOff(d1);
      } else if (status === 0xb0) {
        if (d1 === 1) {
          engine.setMod(d2 / 127);
        } else if (d1 === 123) {
          engine.allNotesOff();
        }
        // CC64 (sustain) intentionally ignored for now.
      } else if (status === 0xe0) {
        const value = ((d2 << 7) | d1) - 8192; // -8192..8191
        const semis = (value / 8192) * 2;
        engine.setBend(semis);
      }
    } catch {
      /* ignore malformed MIDI messages */
    }
  }

  function attachInput(input: any) {
    if (attached.has(input)) return;
    attached.add(input);
    try {
      input.onmidimessage = handleMessage;
    } catch {
      /* ignore */
    }
  }

  function attachAll() {
    try {
      access.inputs.forEach((input: any) => attachInput(input));
    } catch {
      /* ignore */
    }
  }

  attachAll();
  reportReady();

  try {
    access.onstatechange = () => {
      attachAll();
      reportReady();
    };
  } catch {
    /* ignore */
  }
}
