# ONNX Runtime Web vendor assets

The eye-tracker extension must never download executable model/runtime code while tracking.

Development provisioning is performed with:

```bash
npm run vendor:onnxruntime
```

The script pins `onnxruntime-web` to version `1.29.0` and provisions only the runtime files needed for the planned WebGPU-first / WASM-fallback gaze pipeline.

Provisioning order:

1. If `node_modules/onnxruntime-web` exists at the exact pinned version, copy the required files from it.
2. Otherwise download the exact versioned distribution files over HTTPS during development only.
3. Write `VENDOR.json` containing file sizes and SHA-256 digests.

At extension runtime, all ONNX Runtime JavaScript/WASM assets are loaded from the extension package itself. No CDN is contacted.
