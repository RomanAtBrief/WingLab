#!/bin/sh
# Wing Lab build: joins the files in src/ into one self-contained HTML page.
#
#   sh build.sh                       -> index.html   (complete page: open locally or publish on GitHub Pages)
#   sh build.sh out.html              -> out.html
#   sh build.sh out.html <three-url>  -> load three.js from another URL (default: bundled three@0.169.0)
#   FRAGMENT=1 sh build.sh frag.html  -> page body only, for hosts that add their own <html>/<head> (e.g. Claude artifacts)
set -e
cd "$(dirname "$0")"
OUT=${1:-index.html}
BASE=${2:-./vendor/three}
{
  if [ -z "$FRAGMENT" ]; then
    cat <<'H'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>body{margin:0}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
H
  fi
  cat src/01-head.html
  printf '<style>\n'
  cat src/tokens.css src/03-design.css
  printf '</style>\n'
  if [ -z "$FRAGMENT" ]; then printf '</head>\n<body>\n'; fi
  cat src/02-body.html
  printf '<script type="importmap">{"imports":{"three":"%s/build/three.module.js","three/addons/":"%s/examples/jsm/"}}</script>\n' "$BASE" "$BASE"
  cat <<'H'
<script type="module">
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
window.WL_MODS = { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment };
H
  cat src/10-physics.js src/20-profile.js src/30-charts.js src/40-kit.js src/41-aircraft.js src/45-env.js src/50-scene.js
  cat src/65-flight-director.js src/70-gpu-core.js src/71-gpu-atmos.js src/72-gpu-mesh.js src/73-gpu-render.js src/74-gpu-terrain.js src/75-gpu-shadow.js src/76-gpu-trees.js src/77-gpu-post.js src/78-gpu-clouds.js src/79-gpu-scene.js src/80-facade.js
  cat src/55-content.js src/60-ui.js
  printf '</script>\n'
  if [ -z "$FRAGMENT" ]; then printf '</body>\n</html>\n'; fi
} > "$OUT"
echo "built $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
