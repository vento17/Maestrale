# Maestrale on macOS

Maestrale is an Electron + React app. It was developed and packaged on Windows.
On a Mac you can **run it in development mode** right away; producing a
distributable **`.dmg`** needs a bit of porting work (see the last section).

The core of the app works cross-platform: MIDI, OSC, Art-Net, sACN, Enttec DMX,
and the whole widget / timeline / routing / link system. Only **Spout** video
input is Windows-only (its macOS equivalent is **Syphon**, not yet ported).

---

## 1. Prerequisites (install once)

- **Node.js 20 LTS** — https://nodejs.org (or `brew install node@20`)
- **Xcode Command Line Tools** — needed to compile the native MIDI/DMX modules:
  ```bash
  xcode-select --install
  ```
- **Python 3.12** — only needed if you want to build the video sidecar
  (Spout/NDI). Skip it if you don't use the Spout/NDI Input widgets.
  ```bash
  brew install python@3.12
  ```

---

## 2. Get the source

Do **not** copy the `MaestraleExe*` folders — those are Windows binaries.

Either clone the repo:
```bash
git clone <repo-url> Maestrale
cd Maestrale
```
…or unzip the shared `Maestrale` folder **without** `node_modules/`, `out/`,
and `build/sidecar_dist/` (those are platform-specific and get regenerated).

---

## 3. Run it (development mode)

```bash
npm install      # recompiles @julusian/midi, koffi, serialport for macOS
npm run dev      # launches the app
```

That's it — the app opens. The native modules are rebuilt automatically by
`npm install`. If Electron complains about a native module version, run:
```bash
npm rebuild
```

**Note:** on launch the app tries to start the Spout/NDI sidecar. On macOS that
binary isn't built, so Spout/NDI Input widgets stay empty — everything else
works normally.

Verify the types are clean (optional):
```bash
npm run typecheck   # should exit 0
```

---

## 4. Building a distributable `.dmg` (needs porting — not plug-and-play)

The current build scripts are Windows-only, so a Mac `.dmg` is **not** just
"run one command". Two things must be handled first:

1. **Native deps** — already fine: `npm install` builds them for macOS, and
   `electron-builder` rebuilds them for packaging.

2. **The Python sidecar (Spout/NDI)** — this is the blocker:
   - `npm run build:sidecar` uses Windows syntax and the Windows `SpoutLibrary.dll`:
     ```
     --add-data "src/main/sidecar/spout/SpoutLibrary.dll;spout"
     ```
     On macOS the path separator is `:` (not `;`), and **Spout does not exist**
     (use **Syphon**). NDI has a macOS SDK but the receiver code targets Windows.
   - So the sidecar either needs a macOS port (Syphon + macOS NDI) or must be
     dropped from the Mac build (removing the Spout/NDI Input widgets on Mac).

Once the sidecar situation is decided, packaging is roughly:

```bash
npm run build            # builds main + preload + renderer

# Without the sidecar (no Spout/NDI on Mac): remove the "extraResources"
# sidecar entry in package.json's "build" block first, then:
npx electron-builder --mac dmg
```

`package.json` currently only defines a `win` target. For a proper signed Mac
build you'll also want a `mac` block (category, icon) and, for distribution
outside your own machines, an **Apple Developer ID** certificate +
notarization — otherwise Gatekeeper blocks the `.dmg` on other Macs.

### Recommended: build in CI
`.github/workflows/build.yml` already builds the Windows `.exe`. A `macos-latest`
job (currently commented out at the bottom) can build the `.dmg` once the
sidecar is sorted — that avoids needing a Mac locally and keeps both platforms
reproducible.
