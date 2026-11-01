#!/usr/bin/env python3
"""Export the official L2CS-Net ResNet-50 Gaze360 checkpoint to ONNX.

The official checkpoint is not downloaded or redistributed by this project.
Gaze360's research license covers models trained on the dataset and restricts
redistribution/commercial use. Run this script only after obtaining the
checkpoint yourself under those terms.

Exported project-owned tensor contract:
    input        float32 [1, 3, 448, 448]
    yaw_logits   float32 [1, 90]
    pitch_logits float32 [1, 90]
    features     float32 [1, 2048]

The explicit output names also avoid the yaw/pitch variable-name confusion in
the upstream Pipeline implementation: l2cs/model.py returns yaw first, pitch
second, and this exporter preserves that model-level ordering.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import OrderedDict
from pathlib import Path
from typing import Any, Mapping

import torch
import torch.nn as nn
import torchvision

try:
    import onnx
except ImportError as exc:  # pragma: no cover - user environment dependency
    raise SystemExit(
        "The Python package 'onnx' is required. Install torch, torchvision, and onnx before exporting."
    ) from exc


MODEL_FILE_NAME = "l2cs_resnet50_gaze360.onnx"
CONTRACT_FILE_NAME = "l2cs_resnet50_gaze360.contract.json"

INPUT_NAME = "input"
YAW_OUTPUT_NAME = "yaw_logits"
PITCH_OUTPUT_NAME = "pitch_logits"
FEATURE_OUTPUT_NAME = "features"

INPUT_SHAPE = [1, 3, 448, 448]
YAW_SHAPE = [1, 90]
PITCH_SHAPE = [1, 90]
FEATURE_SHAPE = [1, 2048]


class L2CS(nn.Module):
    """Architecture matching the official L2CS-Net model.py ResNet path."""

    def __init__(self, block: type[nn.Module], layers: list[int], num_bins: int):
        super().__init__()
        self.inplanes = 64

        self.conv1 = nn.Conv2d(
            3,
            64,
            kernel_size=7,
            stride=2,
            padding=3,
            bias=False,
        )
        self.bn1 = nn.BatchNorm2d(64)
        self.relu = nn.ReLU(inplace=True)
        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)

        self.layer1 = self._make_layer(block, 64, layers[0])
        self.layer2 = self._make_layer(block, 128, layers[1], stride=2)
        self.layer3 = self._make_layer(block, 256, layers[2], stride=2)
        self.layer4 = self._make_layer(block, 512, layers[3], stride=2)
        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))

        expansion = getattr(block, "expansion")
        self.fc_yaw_gaze = nn.Linear(512 * expansion, num_bins)
        self.fc_pitch_gaze = nn.Linear(512 * expansion, num_bins)

        # Present in the official architecture/checkpoint even though forward()
        # does not use it. Keeping the layer preserves strict state-dict loading.
        self.fc_finetune = nn.Linear(512 * expansion + 3, 3)

    def _make_layer(
        self,
        block: type[nn.Module],
        planes: int,
        blocks: int,
        stride: int = 1,
    ) -> nn.Sequential:
        expansion = getattr(block, "expansion")
        downsample: nn.Module | None = None

        if stride != 1 or self.inplanes != planes * expansion:
            downsample = nn.Sequential(
                nn.Conv2d(
                    self.inplanes,
                    planes * expansion,
                    kernel_size=1,
                    stride=stride,
                    bias=False,
                ),
                nn.BatchNorm2d(planes * expansion),
            )

        layers: list[nn.Module] = [
            block(self.inplanes, planes, stride, downsample)
        ]
        self.inplanes = planes * expansion

        for _ in range(1, blocks):
            layers.append(block(self.inplanes, planes))

        return nn.Sequential(*layers)

    def forward(
        self,
        x: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        x = self.conv1(x)
        x = self.bn1(x)
        x = self.relu(x)
        x = self.maxpool(x)

        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)
        x = self.avgpool(x)
        features = torch.flatten(x, 1)

        yaw_logits = self.fc_yaw_gaze(features)
        pitch_logits = self.fc_pitch_gaze(features)

        return yaw_logits, pitch_logits, features


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_checkpoint(path: Path) -> Mapping[str, torch.Tensor]:
    try:
        loaded: Any = torch.load(
            path,
            map_location="cpu",
            weights_only=True,
        )
    except TypeError:
        loaded = torch.load(path, map_location="cpu")

    if isinstance(loaded, Mapping) and "state_dict" in loaded:
        state_dict = loaded["state_dict"]
    else:
        state_dict = loaded

    if not isinstance(state_dict, Mapping):
        raise RuntimeError("Checkpoint does not contain a PyTorch state_dict mapping.")

    cleaned: OrderedDict[str, torch.Tensor] = OrderedDict()

    for raw_key, value in state_dict.items():
        if not isinstance(raw_key, str) or not isinstance(value, torch.Tensor):
            raise RuntimeError("Checkpoint state_dict contains an unsupported entry.")

        key = raw_key[7:] if raw_key.startswith("module.") else raw_key
        cleaned[key] = value

    return cleaned


def tensor_shape(value_info: onnx.ValueInfoProto) -> list[int | str]:
    dimensions: list[int | str] = []

    tensor_type = value_info.type.tensor_type
    for dimension in tensor_type.shape.dim:
        if dimension.HasField("dim_value"):
            dimensions.append(int(dimension.dim_value))
        elif dimension.HasField("dim_param"):
            dimensions.append(dimension.dim_param)
        else:
            dimensions.append("?")

    return dimensions


def verify_graph(path: Path) -> dict[str, list[int | str]]:
    exported = onnx.load(path)
    onnx.checker.check_model(exported)

    graph_shapes: dict[str, list[int | str]] = {}

    for value_info in list(exported.graph.input) + list(exported.graph.output):
        graph_shapes[value_info.name] = tensor_shape(value_info)

    expected = {
        INPUT_NAME: INPUT_SHAPE,
        YAW_OUTPUT_NAME: YAW_SHAPE,
        PITCH_OUTPUT_NAME: PITCH_SHAPE,
        FEATURE_OUTPUT_NAME: FEATURE_SHAPE,
    }

    for name, expected_shape in expected.items():
        actual_shape = graph_shapes.get(name)
        if actual_shape != expected_shape:
            raise RuntimeError(
                f"Unexpected ONNX tensor shape for {name}: "
                f"expected {expected_shape}, got {actual_shape}"
            )

    return graph_shapes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export the official L2CS-Net Gaze360 checkpoint to the extension-local ONNX contract."
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        required=True,
        help="Path to the user-obtained official L2CSNet_gaze360.pkl checkpoint.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public/models/l2cs"),
        help="Destination directory (default: public/models/l2cs).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    checkpoint = args.checkpoint.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()

    if not checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {checkpoint}")

    output_dir.mkdir(parents=True, exist_ok=True)

    model_path = output_dir / MODEL_FILE_NAME
    contract_path = output_dir / CONTRACT_FILE_NAME

    model = L2CS(
        torchvision.models.resnet.Bottleneck,
        [3, 4, 6, 3],
        90,
    )
    model.load_state_dict(load_checkpoint(checkpoint), strict=True)
    model.eval()

    dummy_input = torch.zeros(INPUT_SHAPE, dtype=torch.float32)

    with torch.inference_mode():
        torch.onnx.export(
            model,
            dummy_input,
            model_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=[INPUT_NAME],
            output_names=[
                YAW_OUTPUT_NAME,
                PITCH_OUTPUT_NAME,
                FEATURE_OUTPUT_NAME,
            ],
            dynamic_axes=None,
            dynamo=False,
        )

    graph_shapes = verify_graph(model_path)

    contract = {
        "model": "L2CS-Net ResNet-50",
        "trainingDataset": "Gaze360",
        "researchLicenseNotice": (
            "The official Gaze360 license restricts this checkpoint and derived models "
            "to research use and restricts redistribution/commercial use."
        ),
        "sourceArchitecture": "https://github.com/Ahmednull/L2CS-Net",
        "input": {
            "name": INPUT_NAME,
            "dtype": "float32",
            "shape": INPUT_SHAPE,
            "colorOrder": "RGB",
            "normalization": {
                "mean": [0.485, 0.456, 0.406],
                "std": [0.229, 0.224, 0.225],
            },
        },
        "outputs": [
            {"name": YAW_OUTPUT_NAME, "dtype": "float32", "shape": YAW_SHAPE},
            {"name": PITCH_OUTPUT_NAME, "dtype": "float32", "shape": PITCH_SHAPE},
            {"name": FEATURE_OUTPUT_NAME, "dtype": "float32", "shape": FEATURE_SHAPE},
        ],
        "decode": {
            "binCount": 90,
            "binSizeDegrees": 4,
            "minimumDegrees": -180,
            "formula": "sum(softmax(logits) * binIndex) * 4 - 180",
        },
        "graphShapes": graph_shapes,
        "checkpoint": {
            "fileName": checkpoint.name,
            "sha256": sha256(checkpoint),
        },
        "onnx": {
            "fileName": model_path.name,
            "sha256": sha256(model_path),
            "bytes": model_path.stat().st_size,
            "opset": 17,
        },
    }

    contract_path.write_text(
        json.dumps(contract, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Exported: {model_path}")
    print(f"Contract: {contract_path}")
    print(f"ONNX SHA-256: {contract['onnx']['sha256']}")
    print(
        "Research-license reminder: do not redistribute this Gaze360-derived ONNX model "
        "or use it commercially without separate rights."
    )


if __name__ == "__main__":
    main()
