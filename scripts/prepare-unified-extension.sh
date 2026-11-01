#!/usr/bin/env bash
# Prepare the Chrome-installable 'dist/' from the integrated source.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 LTS is required (recommended: Node 22.16+).'
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is required.'
  exit 1
fi

echo '[1/8] Install pinned dependencies'
npm ci

echo '[2/8] Provision local MediaPipe face model + WASM assets'
npm run vendor:mediapipe

echo '[3/8] Provision local WebEyeTrack model + runtime' 
npm run vendor:webeyetrack

echo '[4/8] Provision local ONNX Runtime WASM/WebGPU files'
npm run vendor:onnxruntime

if [[ ! -s public/models/l2cs/l2cs_resnet50_gaze360.onnx ]]; then
  if [[ -z "${L2CS_CHECKPOINT:-}" ]]; then
    cat <<'EOF'
L2CS model not found.
Obtain the official L2CSNet_gaze360.pkl research checkpoint under its
Gaze360 license and export it yourself. Then rerun this script:

  python3 -m venv .venv_l2cs_export
  source .venv_l2cs_export/bin/activate
  pip install torch torchvision onnx
  export L2CS_CHECKPOINT='/absolute/path/to/L2CSNet_gaze360.pkl'
  bash scripts/prepare-unified-extension.sh

No fake model or empty placeholder will be used in the release build.
EOF
    exit 2
  fi
  echo '[5/8] Export actual deep model ONNX with a verified tensor contract'
  npm run export:l2cs -- --checkpoint "$L2CS_CHECKPOINT"
else
  echo '[5/8] Existing L2CS ONNX model found'
fi

echo '[6/8] Verify model/vendor files'
npm run verify:mediapipe
npm run verify:webeyetrack
npm run verify:onnxruntime
npm run verify:l2cs

echo '[7/8] Typecheck, lint and test'
npm run typecheck
npm run lint
npm test
npm run test:uxds

echo '[8/8] Build and validate dist/'
npm run build
printf '\nSuccess. In Chrome open chrome://extensions → Developer mode → Load unpacked → select: %s/dist\n' "$PWD"
