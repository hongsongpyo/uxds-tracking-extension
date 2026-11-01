import {
  createHash
} from "node:crypto";

import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

const PACKAGE_VERSION = "0.0.2";
const UPSTREAM_COMMIT =
  "75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c";

const MODEL_JSON_BLOB_SHA =
  "7963db6c21ef15c8d1ede988503b420960981d25";

const MODEL_WEIGHT_BLOB_SHA =
  "4934aeb0740d32a2b02d952d2d6ce8f229ba36b6";

const MODEL_JSON_SIZE = 44_988;
const MODEL_WEIGHT_SIZE = 624_072;

const here =
  dirname(fileURLToPath(import.meta.url));

const root =
  resolve(here, "..");

const runtimePath =
  resolve(root, "src/vendor/webeyetrack/runtime.cjs");

const licensePath =
  resolve(root, "src/vendor/webeyetrack/LICENSE");

const vendorMetadataPath =
  resolve(root, "public/models/webeyetrack/VENDOR.json");

const modelJsonPath =
  resolve(root, "public/models/webeyetrack/web/model.json");

const modelWeightPath =
  resolve(
    root,
    "public/models/webeyetrack/web/group1-shard1of1.bin"
  );

const runtimeUrl =
  `https://cdn.jsdelivr.net/npm/webeyetrack@${PACKAGE_VERSION}/dist/index.js`;

const repositoryRawBase =
  `https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/${UPSTREAM_COMMIT}`;

const modelRawBase =
  `${repositoryRawBase}/js/examples/minimal-example/public/web`;

const licenseUrl =
  `${repositoryRawBase}/LICENSE`;

const modelJsonUrl =
  `${modelRawBase}/model.json`;

const modelWeightUrl =
  `${modelRawBase}/group1-shard1of1.bin`;

const upstreamMediaPipeWasmUrl =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";

const upstreamFaceLandmarkerUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const localMediaPipeWasmPath =
  "/wasm";

const localFaceLandmarkerPath =
  "/models/face_landmarker.task";

const isCheckOnly =
  process.argv.includes("--check");

function sha256(
  bytes
) {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function gitBlobSha1(
  bytes
) {
  const header =
    Buffer.from(`blob ${bytes.length}\0`, "utf8");

  return createHash("sha1")
    .update(header)
    .update(bytes)
    .digest("hex");
}

async function fetchBytes(
  url
) {
  const response =
    await globalThis.fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

async function ensureParent(
  path
) {
  await mkdir(
    dirname(path),
    {
      recursive: true
    }
  );
}

async function writeBytes(
  path,
  bytes
) {
  await ensureParent(path);
  await writeFile(path, bytes);
}

function patchRuntime(
  bytes
) {
  const source =
    bytes.toString("utf8");

  const patched =
    source
      .replaceAll(
        upstreamMediaPipeWasmUrl,
        localMediaPipeWasmPath
      )
      .replaceAll(
        upstreamFaceLandmarkerUrl,
        localFaceLandmarkerPath
      );

  if (
    patched.includes(upstreamMediaPipeWasmUrl)
    || patched.includes(upstreamFaceLandmarkerUrl)
  ) {
    throw new Error(
      "Failed to remove WebEyeTrack's known remote MediaPipe asset URLs."
    );
  }

  return Buffer.from(
    patched,
    "utf8"
  );
}

function assertExactModelFile(
  bytes,
  expectedSize,
  expectedBlobSha,
  label
) {
  if (bytes.length !== expectedSize) {
    throw new Error(
      `${label} size mismatch: expected ${expectedSize}, got ${bytes.length}.`
    );
  }

  const actualBlobSha =
    gitBlobSha1(bytes);

  if (actualBlobSha !== expectedBlobSha) {
    throw new Error(
      `${label} Git blob SHA mismatch: expected ${expectedBlobSha}, got ${actualBlobSha}.`
    );
  }
}

function assertModelManifest(
  bytes
) {
  let manifest;

  try {
    manifest =
      JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      "WebEyeTrack model.json is not valid JSON.",
      {
        cause: error
      }
    );
  }

  const manifests =
    Array.isArray(manifest.weightsManifest)
      ? manifest.weightsManifest
      : [];

  const referencedPaths =
    manifests.flatMap(
      (entry) =>
        Array.isArray(entry.paths)
          ? entry.paths
          : []
    );

  if (
    !referencedPaths.includes(
      "group1-shard1of1.bin"
    )
  ) {
    throw new Error(
      "WebEyeTrack model.json does not reference the expected weight shard."
    );
  }
}

function assertRuntime(
  bytes
) {
  const source =
    bytes.toString("utf8");

  if (
    source.includes(
      "__WEBEYETRACK_VENDOR_STUB__"
    )
  ) {
    throw new Error(
      "WebEyeTrack runtime is still the development stub. Run `npm run vendor:webeyetrack` while online."
    );
  }

  if (
    source.includes(upstreamMediaPipeWasmUrl)
    || source.includes(upstreamFaceLandmarkerUrl)
  ) {
    throw new Error(
      "WebEyeTrack runtime still contains known remote MediaPipe asset URLs."
    );
  }
}

async function buildMetadata(
  runtimeBytes,
  modelJsonBytes,
  modelWeightBytes
) {
  return {
    package: "webeyetrack",
    packageVersion: PACKAGE_VERSION,
    upstreamRepository:
      "RedForestAI/WebEyeTrack",
    upstreamCommit:
      UPSTREAM_COMMIT,
    runtimeSource:
      runtimeUrl,
    modelSourceCommit:
      UPSTREAM_COMMIT,
    runtimePatchedExternalMediaPipeUrls:
      true,
    files: {
      runtime: {
        path:
          "src/vendor/webeyetrack/runtime.cjs",
        size:
          runtimeBytes.length,
        sha256:
          sha256(runtimeBytes)
      },
      modelJson: {
        path:
          "public/models/webeyetrack/web/model.json",
        size:
          modelJsonBytes.length,
        sha256:
          sha256(modelJsonBytes),
        upstreamGitBlobSha1:
          MODEL_JSON_BLOB_SHA
      },
      modelWeights: {
        path:
          "public/models/webeyetrack/web/group1-shard1of1.bin",
        size:
          modelWeightBytes.length,
        sha256:
          sha256(modelWeightBytes),
        upstreamGitBlobSha1:
          MODEL_WEIGHT_BLOB_SHA
      }
    }
  };
}

async function readInstalledFile(
  path,
  label
) {
  try {
    return await readFile(path);
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      throw new Error(
        `${label} is not installed. Run \`npm run vendor:webeyetrack\` once while online.`
      );
    }

    throw error;
  }
}

async function verifyInstalledFiles() {
  const [
    runtimeBytes,
    modelJsonBytes,
    modelWeightBytes
  ] = await Promise.all([
    readInstalledFile(
      runtimePath,
      "WebEyeTrack runtime"
    ),
    readInstalledFile(
      modelJsonPath,
      "WebEyeTrack model.json"
    ),
    readInstalledFile(
      modelWeightPath,
      "WebEyeTrack weight shard"
    )
  ]);

  assertRuntime(runtimeBytes);

  assertExactModelFile(
    modelJsonBytes,
    MODEL_JSON_SIZE,
    MODEL_JSON_BLOB_SHA,
    "WebEyeTrack model.json"
  );

  assertExactModelFile(
    modelWeightBytes,
    MODEL_WEIGHT_SIZE,
    MODEL_WEIGHT_BLOB_SHA,
    "WebEyeTrack weight shard"
  );

  assertModelManifest(
    modelJsonBytes
  );

  const metadata =
    await buildMetadata(
      runtimeBytes,
      modelJsonBytes,
      modelWeightBytes
    );

  return {
    runtimeBytes,
    modelJsonBytes,
    modelWeightBytes,
    metadata
  };
}

async function install() {
  console.log(
    `Provisioning WebEyeTrack ${PACKAGE_VERSION} from pinned upstream commit ${UPSTREAM_COMMIT}...`
  );

  const [
    runtimeDownload,
    modelJsonBytes,
    modelWeightBytes,
    licenseBytes
  ] = await Promise.all([
    fetchBytes(runtimeUrl),
    fetchBytes(modelJsonUrl),
    fetchBytes(modelWeightUrl),
    fetchBytes(licenseUrl)
  ]);

  assertExactModelFile(
    modelJsonBytes,
    MODEL_JSON_SIZE,
    MODEL_JSON_BLOB_SHA,
    "WebEyeTrack model.json"
  );

  assertExactModelFile(
    modelWeightBytes,
    MODEL_WEIGHT_SIZE,
    MODEL_WEIGHT_BLOB_SHA,
    "WebEyeTrack weight shard"
  );

  assertModelManifest(
    modelJsonBytes
  );

  const runtimeBytes =
    patchRuntime(runtimeDownload);

  assertRuntime(runtimeBytes);

  await Promise.all([
    writeBytes(
      runtimePath,
      runtimeBytes
    ),
    writeBytes(
      modelJsonPath,
      modelJsonBytes
    ),
    writeBytes(
      modelWeightPath,
      modelWeightBytes
    ),
    writeBytes(
      licensePath,
      licenseBytes
    )
  ]);

  const metadata =
    await buildMetadata(
      runtimeBytes,
      modelJsonBytes,
      modelWeightBytes
    );

  await writeBytes(
    vendorMetadataPath,
    Buffer.from(
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8"
    )
  );

  console.log(
    "WebEyeTrack local runtime and BlazeGaze model assets were provisioned successfully."
  );
}

async function check() {
  const result =
    await verifyInstalledFiles();

  console.log(
    `WebEyeTrack local assets verified: runtime ${result.metadata.files.runtime.size} bytes, model ${result.modelJsonBytes.length} + ${result.modelWeightBytes.length} bytes.`
  );
}

if (isCheckOnly) {
  await check();
} else {
  await install();
  await check();
}
