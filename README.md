# Patchbay

A modular synthesizer that runs in your browser and that you can play right away. It opens with a finished instrument. Press the big button and it makes music. You can then pull it apart, re-patch the cables and make it your own.

## Play it

1. Press **Start**. The bass line begins at a gentle volume.
2. Turn the four big **Sound** knobs on the right. Each one moves several real module knobs at once.
3. Play notes with the on-screen keys, your computer keyboard or a MIDI keyboard. On the bass and the ambient patch, a key press transposes the running sequence.
4. Pick another instrument from the menu at the top left:
   - **Night Drive Bass**: a rhythmic sequenced bass line.
   - **Glass Cathedral Pad**: hold chords (use the chord pads or press several keys at once).
   - **Solar Lead**: a single-note lead with glide and vibrato. Drag the **Expression** strip to open it up.
   - **Tidepool**: a generative piece that plays itself.
5. **Stop** (or `Esc`) silences everything at once, echoes included.

### Keys

| Key | Action |
| --- | --- |
| `A S D F G H J K L ;` | White notes (C D E F G A B C D E) |
| `W E T Y U O P` | Sharps and flats |
| `Z` / `X` | Octave down / up |
| `Space` | Play or pause the sequencer |
| `Esc` | Stop all sound |

### Patching

- **Move** a module by dragging its title bar. **Pan** the canvas by dragging empty space. **Zoom** with the mouse wheel, a pinch, or the − / + / Fit buttons.
- **Connect** two ports by dragging from one jack to another. Compatible jacks glow; incompatible ones dim. If a connection isn't allowed, a message says why.
- **Disconnect** a cable by clicking it and pressing × (or `Delete`), or grab the cable end at an input and drop it somewhere else.
- **Add** modules with **+ Add module** (or double-click empty canvas). **Remove** a module with the × in its header.
- **Inspect** a signal by clicking any output jack. The Scope panel then shows that signal's live waveform and spectrum, labelled with its name. Click **Master** to go back to the main output.
- Cable colours follow the kind of signal. Cables glow with the real level of the signal they carry, and gate cables flash on every note.

Signal kinds: **audio** (sound), **CV** (control voltage: pitch, envelopes, LFOs) and **gate** (note on/off events). Audio and CV can be patched into each other. Gates only go to gate inputs.

### Keep and share

- Your current patch is saved automatically in the browser and comes back next time you open Patchbay.
- **Save** stores named patches in the browser. They appear in the instrument menu.
- **Share** copies a link. The whole patch is packed into the part of the URL after `#`, so no server is involved.
- **⋯ → Export / Import** saves and loads patches as `.json` files.
- **Rec** records the master output. Press it again to stop, then listen to the clip and download it as a `.wav`.

## Build and run

```bash
npm ci
npm run dev          # development server
npm run build        # type-check + static site in dist/ (index.html at its root)
npm test             # unit tests (patch validation, share links, WAV encoding)
npm run test:e2e     # production build in headless Chromium, served under /patchbay-claude/
npm run preview      # serve dist/ under /patchbay-claude/ at http://127.0.0.1:4173/patchbay-claude/
```

The build uses a relative base (`./`), so `dist/` works when served from any subpath, for example `https://<user>.github.io/patchbay-claude/`. It needs no special server headers. Fonts, the recorder AudioWorklet and all code are bundled. There are no runtime network calls.

## How it works

- **Vite + TypeScript** with no UI framework. Modules are DOM elements, cables are SVG, and the scope is Canvas 2D.
- **Web Audio API** does all the sound. Each module is a small graph of native nodes (oscillators, biquad filters, gains, delays, a convolver with a generated impulse response). Cables are real `AudioNode.connect()` calls. CV inputs drive `AudioParam`s: pitch and filter cutoff are summed into the `detune` params in cents, so 1.0 means one octave.
- **Polyphony**: a Keys module with several voices makes every module downstream of it run one copy per voice. Where voices meet a mono module, such as the effects, they are summed.
- **Gates** are note events scheduled ahead of time (sample-accurate), not audio.
- **Sequencer timing** runs on a look-ahead scheduler driven by a Worker timer, so it keeps time when the tab is in the background.
- `src/core/store.ts` holds the patch, which is the single source of truth. The engine and every view subscribe to it, so knobs, macros, cables and sound always agree.
