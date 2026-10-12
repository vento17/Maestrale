# Maestrale

A modular touch-controller builder for live shows — Electron + React + zustand.

Build layouts of sliders, knobs, buttons, XY pads, LFOs, envelopes, step
sequencers, a multi-track timeline, cues, submasters and more, then drive them
out over **MIDI, OSC, Art-Net, sACN** and **Enttec Open DMX**. Right-click any
control to link it (master/slave via a Router), record cues, sync to LTC/MTC
timecode, and control everything remotely from a phone or tablet browser.

For lighting, there is a full **ETC Eos** surface — every key, four encoders
that page with the desk, the level wheel, the masters and the Grandmaster —
plus endless **encoders** that send only the change, so the desk never jumps,
and an **Eos user** of its own so Maestrale does not fight the operator.
A hardware surface comes in over MIDI: the **iControls** widget picks up an
iCON iControls in Mackie mode, nine faders and nine knobs, each one a cell you
can patch anywhere. Colour presets come from a **Palette** of swatches through
a **Merge** set to LTP, and a **Shell** widget switches the PC off at the end
of the night from a Clock row: an installation boots into its show and puts
itself to bed.

## Download

Ready-made builds are on the
[Releases page](https://github.com/vento17/Maestrale/releases/latest):
a portable `.exe` for Windows (nothing to install) and `.dmg` for macOS,
Intel and Apple Silicon.

## Build

```bash
npm install
npm run dev        # run in development
npm run typecheck  # type-check main + renderer (should be clean)
npm run dist       # Windows portable .exe (needs Python + PyInstaller for the sidecar)
```

macOS: see [BUILD_MAC.md](BUILD_MAC.md). Windows `.exe` and macOS `.dmg`
(without Spout/NDI) are also built by GitHub Actions — see
`.github/workflows/build.yml`.

## Notes

- **Spout / NDI** video input is **Windows-only**; those widgets are disabled on
  other platforms. NDI requires the separately-installed NDI runtime — it is not
  redistributed with the app.
- Project files written by version 0.3 and earlier (`.liveforge`) open unchanged.

## License

Copyright (C) 2026 vento17.

Maestrale is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License v3.0 or later** — see [LICENSE](LICENSE).
It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.
