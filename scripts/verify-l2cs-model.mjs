import {
  access,
  readFile,
  stat
} from "node:fs/promises";

import {
  createHash
} from "node:crypto";

import {
  dirname,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

const here =
  dirname(fileURLToPath(import.meta.url));

const root =
  resolve(here, "..");

const modelRoot =
  resolve(
    root,
    "public/models/l2cs"
  );

const modelPath =
  resolve(
    modelRoot,
    "l2cs_resnet50_gaze360.onnx"
  );

const contractPath =
  resolve(
    modelRoot,
    "l2cs_resnet50_gaze360.contract.json"
  );

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  const contents =
    await readFile(path);

  return createHash("sha256")
    .update(contents)
    .digest("hex");
}

async function main() {
  if (!(await exists(modelPath))) {
    throw new Error(
      "L2CS ONNX model is missing. Obtain the official research checkpoint yourself, then run `npm run export:l2cs -- --checkpoint /path/to/L2CSNet_gaze360.pkl`."
    );
  }

  if (!(await exists(contractPath))) {
    throw new Error(
      "L2CS model contract is missing. Re-run `npm run export:l2cs`."
    );
  }

  const contract =
    JSON.parse(
      await readFile(
        contractPath,
        "utf8"
      )
    );

  const expectedOutputs = [
    "yaw_logits",
    "pitch_logits",
    "features"
  ];

  if (
    contract?.input?.name !== "input"
    || !Array.isArray(contract?.outputs)
    || expectedOutputs.some(
      (name) =>
        !contract.outputs.some(
          (output) =>
            output?.name === name
        )
    )
    || contract?.onnx?.fileName
      !== "l2cs_resnet50_gaze360.onnx"
    || typeof contract?.onnx?.sha256
      !== "string"
  ) {
    throw new Error(
      "L2CS model contract does not match the expected project tensor names."
    );
  }

  const modelStats =
    await stat(modelPath);

  if (
    typeof contract.onnx.bytes === "number"
    && contract.onnx.bytes
      !== modelStats.size
  ) {
    throw new Error(
      "L2CS ONNX file size does not match the export contract."
    );
  }

  const digest =
    await sha256(modelPath);

  if (digest !== contract.onnx.sha256) {
    throw new Error(
      "L2CS ONNX SHA-256 does not match the export contract."
    );
  }

  console.log(
    "Verified extension-local L2CS ONNX model and export contract."
  );
  console.log(
    `Model: ${modelStats.size} bytes, sha256=${digest}`
  );
  console.log(
    "Research-license reminder: the Gaze360-derived checkpoint/model must not be redistributed or used commercially without separate rights."
  );
}

await main();
