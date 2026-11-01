# Local MediaPipe model assets

The extension loads the MediaPipe Face Landmarker model locally.
Do not replace this with a CDN URL in runtime code.

Required file:

- `public/models/face_landmarker.task`

Official MediaPipe model URL:

https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

From the project root on macOS/Linux:

```bash
mkdir -p public/models
curl -L \
  -o public/models/face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
```

The WASM runtime files are copied from the pinned npm package
`@mediapipe/tasks-vision@1.0.1` into `public/wasm/`.
