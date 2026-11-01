import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";

import {
  createHash
} from "node:crypto";

import {
  dirname,
  relative,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

const here =
  dirname(fileURLToPath(import.meta.url));

const root =
  resolve(here, "..");

const publicRoot =
  resolve(root, "public");

const packageRoot =
  resolve(root, "node_modules/onnxruntime-web");

const vendorRoot =
  resolve(publicRoot, "vendor/onnxruntime");

const wasmRoot =
  resolve(publicRoot, "wasm/onnxruntime");

const metadataPath =
  resolve(vendorRoot, "VENDOR.json");

const PACKAGE_NAME =
  "onnxruntime-web";

const PACKAGE_VERSION =
  "1.29.0";

const LICENSE =
  "MIT";

const CDN_BASE_URL =
  `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist`;

const checkOnly =
  process.argv.includes("--check");

const assets = [
  {
    sourceRelativePath:
      "dist/ort.webgpu.bundle.min.mjs",
    destinationRelativePath:
      "vendor/onnxruntime/ort.webgpu.bundle.min.mjs"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.jsep.mjs",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.mjs"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.jsep.wasm",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.wasm"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.asyncify.mjs",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.asyncify.wasm",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.jspi.mjs",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.mjs"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.jspi.wasm",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.wasm"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.mjs",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.mjs"
  },
  {
    sourceRelativePath:
      "dist/ort-wasm-simd-threaded.wasm",
    destinationRelativePath:
      "wasm/onnxruntime/ort-wasm-simd-threaded.wasm"
  }
];

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

async function readInstalledPackageVersion() {
  const packageJsonPath =
    resolve(packageRoot, "package.json");

  if (!(await exists(packageJsonPath))) {
    return null;
  }

  const packageJson =
    JSON.parse(
      await readFile(
        packageJsonPath,
        "utf8"
      )
    );

  return typeof packageJson.version === "string"
    ? packageJson.version
    : null;
}

async function fetchAsset(
  sourceUrl,
  destinationPath
) {
  const response =
    await fetch(sourceUrl, {
      redirect: "follow"
    });

  if (!response.ok) {
    throw new Error(
      `Failed to download ${sourceUrl}: HTTP ${response.status}`
    );
  }

  const data =
    new Uint8Array(
      await response.arrayBuffer()
    );

  await writeFile(
    destinationPath,
    data
  );
}

async function provisionAsset(
  asset,
  installedVersion
) {
  const destinationPath =
    resolve(
      publicRoot,
      asset.destinationRelativePath
    );

  await mkdir(
    dirname(destinationPath),
    {
      recursive: true
    }
  );

  if (installedVersion === PACKAGE_VERSION) {
    const sourcePath =
      resolve(
        packageRoot,
        asset.sourceRelativePath
      );

    if (!(await exists(sourcePath))) {
      throw new Error(
        `Installed ${PACKAGE_NAME}@${PACKAGE_VERSION} is missing ${asset.sourceRelativePath}.`
      );
    }

    await copyFile(
      sourcePath,
      destinationPath
    );

    return "node_modules";
  }

  const fileName =
    asset.sourceRelativePath.split("/").at(-1);

  if (fileName === undefined) {
    throw new Error(
      `Invalid ONNX Runtime asset path: ${asset.sourceRelativePath}`
    );
  }

  await fetchAsset(
    `${CDN_BASE_URL}/${fileName}`,
    destinationPath
  );

  return "pinned-cdn";
}

async function writeVendorMetadata(
  provisionSource
) {
  const files = [];

  for (const asset of assets) {
    const absolutePath =
      resolve(
        publicRoot,
        asset.destinationRelativePath
      );

    const fileStats =
      await stat(absolutePath);

    files.push({
      path:
        asset.destinationRelativePath,
      bytes:
        fileStats.size,
      sha256:
        await sha256(absolutePath)
    });
  }

  const metadata = {
    package:
      PACKAGE_NAME,
    version:
      PACKAGE_VERSION,
    license:
      LICENSE,
    provisionSource,
    sourceBaseUrl:
      CDN_BASE_URL,
    runtimePolicy:
      "Extension runtime loads only these local bundled assets; the CDN is development-time provisioning only.",
    files
  };

  await mkdir(
    vendorRoot,
    {
      recursive: true
    }
  );

  await writeFile(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

async function verifyVendorAssets() {
  if (!(await exists(metadataPath))) {
    throw new Error(
      "ONNX Runtime vendor metadata is missing. Run `npm run vendor:onnxruntime`."
    );
  }

  const metadata =
    JSON.parse(
      await readFile(
        metadataPath,
        "utf8"
      )
    );

  if (
    metadata.package !== PACKAGE_NAME
    || metadata.version !== PACKAGE_VERSION
  ) {
    throw new Error(
      `ONNX Runtime vendor metadata must describe ${PACKAGE_NAME}@${PACKAGE_VERSION}.`
    );
  }

  if (!Array.isArray(metadata.files)) {
    throw new Error(
      "ONNX Runtime vendor metadata has no file manifest."
    );
  }

  const expectedPaths =
    new Set(
      assets.map(
        (asset) =>
          asset.destinationRelativePath
      )
    );

  const metadataPaths =
    new Set(
      metadata.files.map(
        (file) => file.path
      )
    );

  for (const expectedPath of expectedPaths) {
    if (!metadataPaths.has(expectedPath)) {
      throw new Error(
        `ONNX Runtime vendor metadata is missing ${expectedPath}.`
      );
    }
  }

  for (const file of metadata.files) {
    if (
      typeof file.path !== "string"
      || typeof file.sha256 !== "string"
      || typeof file.bytes !== "number"
    ) {
      throw new Error(
        "ONNX Runtime vendor metadata contains an invalid file entry."
      );
    }

    if (!expectedPaths.has(file.path)) {
      continue;
    }

    const absolutePath =
      resolve(
        publicRoot,
        file.path
      );

    if (!(await exists(absolutePath))) {
      throw new Error(
        `Required ONNX Runtime asset is missing: ${relative(root, absolutePath)}`
      );
    }

    const fileStats =
      await stat(absolutePath);

    if (fileStats.size !== file.bytes) {
      throw new Error(
        `ONNX Runtime asset size mismatch: ${file.path}`
      );
    }

    const digest =
      await sha256(absolutePath);

    if (digest !== file.sha256) {
      throw new Error(
        `ONNX Runtime asset hash mismatch: ${file.path}`
      );
    }
  }

  console.log(
    `Verified ${PACKAGE_NAME}@${PACKAGE_VERSION} local runtime assets.`
  );
}

async function provisionVendorAssets() {
  const installedVersion =
    await readInstalledPackageVersion();

  if (
    installedVersion !== null
    && installedVersion !== PACKAGE_VERSION
  ) {
    throw new Error(
      `Installed ${PACKAGE_NAME} version is ${installedVersion}; expected ${PACKAGE_VERSION}. Remove it or install the pinned version before provisioning.`
    );
  }

  await mkdir(
    vendorRoot,
    {
      recursive: true
    }
  );

  for (const asset of assets) {
    await rm(
      resolve(
        publicRoot,
        asset.destinationRelativePath
      ),
      {
        force: true
      }
    );
  }

  await rm(
    metadataPath,
    {
      force: true
    }
  );

  await mkdir(
    wasmRoot,
    {
      recursive: true
    }
  );

  const sources =
    new Set();

  for (const asset of assets) {
    sources.add(
      await provisionAsset(
        asset,
        installedVersion
      )
    );
  }

  const provisionSource =
    sources.size === 1
      ? [...sources][0]
      : "mixed";

  await writeVendorMetadata(
    provisionSource
  );

  await verifyVendorAssets();
}

if (checkOnly) {
  await verifyVendorAssets();
} else {
  await provisionVendorAssets();
}
