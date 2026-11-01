# L2CS-Net research model provisioning

The L2CS Gaze360 checkpoint and derived ONNX model are intentionally **not**
committed or distributed with this project.

Why: the upstream L2CS-Net code is MIT, but the Gaze360 license covers the
dataset, models trained on it, and derivative works. It restricts use to
research and restricts redistribution/commercial use. Each researcher must
obtain the checkpoint directly from the official L2CS-Net source and comply
with those terms.

## 1. Obtain the checkpoint yourself

Use the official L2CS-Net repository and its model-download link to obtain:

`L2CSNet_gaze360.pkl`

Do not commit the checkpoint to this repository.

## 2. Prepare a Python export environment

The exporter needs Python 3 plus:

```bash
python3 -m venv .venv_l2cs_export
source .venv_l2cs_export/bin/activate
python3 -m pip install torch torchvision onnx
```

## 3. Export the project-owned ONNX tensor contract

From the extension project root:

```bash
npm run export:l2cs -- --checkpoint /absolute/path/to/L2CSNet_gaze360.pkl
```

The exporter creates locally:

- `public/models/l2cs/l2cs_resnet50_gaze360.onnx`
- `public/models/l2cs/l2cs_resnet50_gaze360.contract.json`

Tensor contract:

- input: `input` float32 `[1, 3, 448, 448]`
- output: `yaw_logits` float32 `[1, 90]`
- output: `pitch_logits` float32 `[1, 90]`
- output: `features` float32 `[1, 2048]`

The explicit yaw/pitch names intentionally follow `l2cs/model.py`, whose
forward method returns yaw first and pitch second. This avoids relying on the
ambiguous variable naming in the upstream Python Pipeline.

## 4. Verify the model

```bash
npm run verify:l2cs
```

The verification command checks the local model against the generated
SHA-256 contract.

## 5. Build the extension

Provision ONNX Runtime assets if needed, then build:

```bash
npm run vendor:onnxruntime
npm run validate:l2cs
```

## Runtime privacy

Face crops and normalized image tensors are transient inference inputs only.
They are not written to IndexedDB, extension storage, or the server by the
L2CS engine.
