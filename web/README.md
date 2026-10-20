# Web build

Super Mario 64 compiled to WebAssembly, running entirely in the browser. No ROM
is involved: `build_web.sh` regenerates every texture, glyph and audio sample
from the committed clean-room spec before compiling.

## Play

Locally:

```sh
python3 web/tools/serve.py 3000        # then open http://localhost:3000
```

On a phone it runs the same way; "Add to Home Screen" installs it as an app.
Touch controls appear automatically, and a physical controller takes over when
one connects.

| Input | Buttons |
| --- | --- |
| Keyboard | `WASD` move, `L` jump, `,` punch, `K` crouch, `Space` pause, arrows camera, `R Shift` R |
| Gamepad | Standard mapping: A jump, X punch, LB/LT crouch, Start pause, right stick camera |
| Touch | Left stick, A/B/Z, C-diamond, START |

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: start screen, canvas, boot progress, dev hooks (`?autostart`, `?dump`, `?keys`, `?raw`, `?touch`) |
| `pad.js` | Touch controls. Injects a virtual standard-mapping gamepad into `navigator.getGamepads()` so SDL cannot tell it from a real controller |
| `sw.js` | Service worker: precaches the engine for instant repeat launches and offline play |
| `manifest.webmanifest`, `icon-*.png` | PWA install metadata |
| `sm64.us.js`, `sm64.us.wasm.gz` | Built engine (generated, not hand-edited) |
| `server/worker.js` | Cloudflare Worker that puts the whole site behind Sign in with Freebuff |
| `tools/build_web.sh` | Reproducible build from pinned public sources |
| `tools/smoke_test.mjs` | Headless-browser check that a build actually boots |
| `tools/serve.py`, `tools/mkicons.py` | Local server with correct MIME types; icon generator |

## Build

```sh
export EMSDK=/path/to/emsdk          # or have emcc on PATH
export EM_CACHE=~/.cache/emscripten  # keeps system libs between builds
bash web/tools/build_web.sh dist
node web/tools/smoke_test.mjs dist   # needs: npm i playwright && npx playwright install chromium
```

The script pins `sm64-port` and `sm64-cleanroom` to exact commits, regenerates
assets, patches the build for wasm, compiles, and assembles `dist/`.

### Two build details worth knowing

- `sm64-port`'s `-march=native` is rejected by clang for `wasm32`; the script
  strips it and fails if it ever reappears.
- Linking with `-O3` and without `--profiling-funcs` lets `wasm-opt` run, which
  is what keeps the binary from ballooning. The wasm is then gzipped
  (12.7 MB → 5.7 MB) and decompressed in the browser with `DecompressionStream`,
  handed to Emscripten through `instantiateWasm`. `?raw=1` skips that and loads a
  plain `.wasm` if you ship one.

## Private deployment

`server/worker.js` requires a session before serving any asset, so the built site
cannot be reached without signing in. Bundle it and deploy the result with
`index.js` as the Worker entrypoint and `dist/` as the assets directory:

```sh
esbuild web/server/worker.js --bundle --format=esm --platform=browser --outfile=deploy/index.js
```

## Known limitations

- **Saves do not survive a reload.** The game writes into Emscripten's in-memory
  filesystem; there is no IDBFS mount yet.
- Audio is only started after a user gesture, so it stays silent until the
  player taps to start.
