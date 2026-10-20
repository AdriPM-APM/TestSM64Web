#!/usr/bin/env bash
# Build the Super Mario 64 web port from public sources — no ROM required.
#
#   web/tools/build_web.sh [output-dir]        (default: dist)
#
# What it does:
#   1. clones the game source (sm64-port) and the clean-room asset generator
#      (sm64-cleanroom), both pinned to exact commits;
#   2. regenerates every texture, glyph and audio sample from the committed
#      clean-room spec, so extract_assets.py never runs and no baserom is needed;
#   3. compiles the web target with Emscripten;
#   4. assembles the site from this repo's shell files plus the built engine.
#
# Requirements: bash, git, python3 with numpy, make, gzip, and emcc on PATH.
#   Emscripten: https://github.com/emscripten-core/emsdk  (pin 6.0.13)
#   export EM_CACHE to a persistent dir in CI to make rebuilds much faster.
#
# Environment:
#   WORK      scratch directory (default: <repo>/.build)
#   JOBS      parallel compile jobs (default: nproc)
#   EMSDK     emsdk root; its emscripten/ and upstream/bin/ are added to PATH
set -euo pipefail

SM64_PORT_URL="https://github.com/sm64-port/sm64-port.git"
SM64_PORT_SHA="2b17d081c9798b31b91dc71f37994b0da28cffc9"
CLEANROOM_URL="https://github.com/andrewnakas/sm64-cleanroom.git"
CLEANROOM_SHA="68e78a84e890110115f647100a846d43e1506b2e"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # web/tools
WEB_DIR="$(dirname "$HERE")"                           # web
REPO_DIR="$(dirname "$WEB_DIR")"                       # repo root

OUT="${1:-$REPO_DIR/dist}"
WORK="${WORK:-$REPO_DIR/.build}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"

log() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
log "preflight"
command -v git  >/dev/null || die "git is required"
command -v make >/dev/null || die "make is required"
python3 -c 'import numpy' 2>/dev/null || die "python3 with numpy is required (pip install numpy)"
command -v gzip >/dev/null || die "gzip is required"

if [ -n "${EMSDK:-}" ]; then
  export PATH="$EMSDK/upstream/emscripten:$EMSDK/upstream/bin:$PATH"
fi
command -v emcc >/dev/null || \
  die "emcc not found. Install emsdk and either put it on PATH or set EMSDK=<emsdk root>."
emcc --version | head -1

# The output dir is wiped before assembly. Refuse any target whose *contents*
# would delete the sources this script copies from (e.g. `build_web.sh web` or
# `... .`). Building into a subdirectory of the repo (e.g. dist/) is fine.
OUT_ABS="$(realpath -m "$OUT")"
for protected in "$(realpath -m "$WEB_DIR")" "$(realpath -m "$REPO_DIR")"; do
  case "$OUT_ABS" in
    "$protected")
      die "refusing to build into $OUT_ABS: it is $protected itself. Use a separate output dir, e.g. dist/"
      ;;
  esac
  case "$protected" in
    "$OUT_ABS"/*)
      die "refusing to build into $OUT_ABS: $protected is inside it, so the wipe would delete sources"
      ;;
  esac
done

mkdir -p "$WORK" "$OUT"
echo "work:   $WORK"
echo "output: $OUT"
echo "jobs:   $JOBS"

# Pinned, shallow clone straight to a commit.
fetch_at() { # url sha dir
  local url="$1" sha="$2" dir="$3"
  if [ ! -d "$dir/.git" ]; then
    rm -rf "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  git -C "$dir" fetch -q --depth 1 origin "$sha"
  git -C "$dir" checkout -q FETCH_HEAD
  git -C "$dir" clean -qfdx
  echo "  $dir @ $(git -C "$dir" rev-parse --short HEAD)"
}

# ------------------------------------------------------------------- sources
log "fetching sources"
fetch_at "$SM64_PORT_URL" "$SM64_PORT_SHA" "$WORK/sm64-port"
fetch_at "$CLEANROOM_URL" "$CLEANROOM_SHA" "$WORK/cleanroom"

TREE="$WORK/sm64-web"
rm -rf "$TREE"

# --------------------------------------------------------------- clean assets
# Regenerates textures/fonts/glyphs/audio from coarse facts kept in the spec.
# This is what removes the need for a baserom.
log "generating clean-room assets (no ROM)"
( cd "$WORK/cleanroom" && python3 -m games.sm64.generate "$WORK/sm64-port" "$TREE" )

[ -f "$TREE/.assets-local.txt" ] || die "asset generation did not produce .assets-local.txt"

# --------------------------------------------------------------------- patch
log "applying web patches"
( cd "$WORK/cleanroom" && python3 -m games.sm64.port_patches "$TREE" )

# Two things port_patches leaves behind, both fatal or suboptimal for a web build:
#   1. -march=native is rejected by clang for wasm32 ("unsupported option").
#   2. the link step carried --profiling-funcs and no -O, so wasm-opt never ran
#      and the binary was 12.7 MB. -O3 at link gets it to ~the same size as the
#      C objects allow while keeping semantics identical.
sed -i 's/ -fwrapv -march=native$/ -fwrapv/' "$TREE/Makefile"
sed -i 's/--profiling-funcs//' "$TREE/Makefile"
sed -i 's/^  PLATFORM_LDFLAGS := -lm -no-pie -s INITIAL_MEMORY/  PLATFORM_LDFLAGS := -lm -no-pie -O3 -s INITIAL_MEMORY/' "$TREE/Makefile"

grep -q 'march=native' "$TREE/Makefile" && die "-march=native still present in Makefile"
grep -q -- '--profiling-funcs' "$TREE/Makefile" && die "--profiling-funcs still present in Makefile"

# ---------------------------------------------------------------------- build
log "compiling (this is the long part)"
( cd "$TREE" && make -j"$JOBS" TARGET_WEB=1 NOEXTRACT=1 VERSION=us ENABLE_OPENGL=1 )

BUILD="$TREE/build/us_web"
WASM="$BUILD/sm64.us.wasm"
JS="$BUILD/sm64.us.js"
[ -f "$WASM" ] || die "build produced no wasm at $WASM"
[ -f "$JS" ]   || die "build produced no js at $JS"
[ "$(head -c 4 "$WASM" | od -An -tx1 | tr -d ' \n')" = "0061736d" ] || die "$WASM is not a valid wasm binary"

# ------------------------------------------------------------------- package
log "packaging site -> $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

for f in index.html pad.js sw.js manifest.webmanifest icon-192.png icon-512.png; do
  [ -f "$WEB_DIR/$f" ] || die "missing shell file: $WEB_DIR/$f"
  cp "$WEB_DIR/$f" "$OUT/$f"
done

cp "$JS" "$OUT/sm64.us.js"
gzip -9 -n -c "$WASM" > "$OUT/sm64.us.wasm.gz"
# Keep the raw binary too when asked; the deployed site only needs the .gz
# (it decompresses in the browser), and 12.7 MB exceeds most per-file limits.
if [ "${WITH_RAW_WASM:-0}" = "1" ]; then cp "$WASM" "$OUT/sm64.us.wasm"; fi

printf '    %8s  %s\n' "$(stat -c%s "$JS" 2>/dev/null || stat -f%z "$JS")" "sm64.us.js"
printf '    %8s  %s\n' "$(stat -c%s "$OUT/sm64.us.wasm.gz" 2>/dev/null || stat -f%z "$OUT/sm64.us.wasm.gz")" "sm64.us.wasm.gz"
printf '\nbuilt %s\n' "$OUT"
