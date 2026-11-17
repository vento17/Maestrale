# Maestrale

**A control surface you build yourself, for live shows.**
Lay out faders, buttons, timelines, cues and generators on a canvas, patch
them together with cables, and send everything out over **MIDI, OSC, Art-Net,
sACN** and **Enttec Open DMX**. Run it full screen on a touch monitor, or open
it from a phone or tablet on the same network.

Built for the people who run the show: lighting, video mapping, theatre,
installations that boot into their show and switch themselves off at night.
Made by [Ventoland](https://ventoland.it).

<p align="center"><img src="Logo.png" alt="Maestrale" width="180"></p>

## What it does

**Build** — one view, two modes. DESIGN lays frames over the page: drop
widgets, move and resize them, copy, paste, undo. LIVE plays them. The page
looks exactly the same in both, and switching never stops the show. The
parameters column on the right (P) is the same in both modes.

**Patch** — Tap **Shift** and every control grows dots: orange for what it
sends, blue for what can drive it. Drag a cable from one to the other and it is
linked. Right-click → Learn picks up a MIDI, OSC, Art-Net or sACN source by
moving it. The Router page lists every link, with ranges and curves.

**Play** — a multi-track **Timeline** (value, colour, trigger, cue, wait and
sound tracks; chases LTC / MTC timecode), **Cues** that snapshot the desk and
bring it back, with an optional fade, **Submasters**, **LFO**, **Noise**, **Graph**, **Step
sequencer**, **Sketch** (draw a movement and play it back), **Math** and
**Merge** (LTP / HTP / min / average).

**Control** — sliders, knobs, buttons, XY pads, a computer **Keyboard**, a
**Clock** that fires at times of day, endless **Encoders** that send only the
change, a full **ETC Eos** surface (keys, paged encoders, level wheel, masters,
Grandmaster, its own Eos user), and the **iCON iControls** in Mackie mode.

**See what is happening** — **DMX Monitor** (a universe as a grid, in or out),
**OSC Monitor** and **MIDI Monitor** (every address / CC / note that arrives,
one row each, its value live, every row patchable), Value Display, audio
meters and analyser, Spout and NDI video in.

**Record and play DMX** — the DMX Recorder writes the incoming Art-Net or sACN
stream to disk with its own timing; the DMX Player plays it back, looped,
scrubbed, on another universe.

**Run unattended** — a **Startup** widget fires its triggers when the show
starts, each after its own delay; a **Shell** widget runs actions on the PC
(turn off, restart, open a file) and can shut it down from a Clock row.

### New in 0.4.5

- **SETTINGS · DESIGN · LIVE**: Design is the Live page with frames to move and
  resize widgets (the snap grid behind them); Live plays. One view, so what
  you arrange is exactly what plays.
- **One parameters column** in both modes — **P** or the arrow — with a big
  **EDIT** button for cell names / colours / mappings (and a submaster's scenes).
- **Wire** button next to it: the patch cables, the same as a tap on Shift.
- Every widget starts with its **Label** and labels are unique (Lights,
  Lights 2…); cables follow the widget, never its name.
- **Palette SELECTED output**: the picked colour's R G B on one dot — one cable
  into a Merge.
- Tested core (181 automatic tests run before every build).

## Download

Ready-made builds are on the
[Releases page](https://github.com/vento17/Maestrale/releases/latest):
a portable `.exe` for Windows (nothing to install) and a `.dmg` for macOS,
Intel and Apple Silicon.

## Notes

- **Spout / NDI** video input is **Windows-only**; those widgets are disabled on
  other platforms. NDI requires the separately-installed NDI runtime — it is not
  redistributed with the app.
- Project files written by version 0.3 and earlier (`.liveforge`) open unchanged.
- Bugs and ideas: open an Issue here.
- The built-in **Manual** widget explains every widget and setting.

## License

Copyright (C) 2026 Luca Lorenzo Ferro — Ventoland (ventoland.it). All rights reserved.

Maestrale is **freeware**: free to download and use, for shows of any kind,
commercial ones included. The source code is not public. See [LICENSE](LICENSE).
Versions up to 0.4.3 were published under the GPL v3.
