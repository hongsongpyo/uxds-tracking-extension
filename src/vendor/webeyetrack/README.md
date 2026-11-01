# WebEyeTrack vendor runtime

`runtime.cjs` is a development stub in source snapshots until the vendor step is
run. Execute:

```bash
npm run vendor:webeyetrack
npm run verify:webeyetrack
```

The provisioning script pins WebEyeTrack `0.0.2`, the upstream repository
commit recorded in `src/shared/constants.ts`, and the BlazeGaze model files from
that same repository state. It also replaces WebEyeTrack's known remote
MediaPipe asset URLs with extension-local paths.

At runtime the project does **not** call WebEyeTrack's own FaceLandmarker
initializer. `LocalWebEyeTrackBackend` injects the face result already computed
by the project's Face pipeline, loads only the local BlazeGaze model, and
captures the model output before WebEyeTrack's Kalman filter.

Do not edit the provisioned runtime manually. Re-run the vendor command instead.
