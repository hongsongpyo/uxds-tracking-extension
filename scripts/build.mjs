import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";

import {
  dirname,
  extname,
  relative,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  build
} from "esbuild";

const here =
  dirname(fileURLToPath(import.meta.url));

const root =
  resolve(here, "..");

const srcRoot =
  resolve(root, "src");

const publicRoot =
  resolve(root, "public");

const distRoot =
  resolve(root, "dist");

const manifestSourcePath =
  resolve(root, "manifest.json");

const manifestOutputPath =
  resolve(distRoot, "manifest.json");

const moduleEntryPoints = [
  resolve(srcRoot, "background/serviceWorker.ts"),
  resolve(srcRoot, "offscreen/offscreen.ts"),
  resolve(srcRoot, "popup/popup.ts"),
  resolve(srcRoot, "camera-permission/camera-permission.ts")
];

const contentScriptEntryPoint =
  resolve(srcRoot, "content/contentScript.ts");

const entryPoints = [
  ...moduleEntryPoints,
  contentScriptEntryPoint
];

const requiredSourceFiles = [
  manifestSourcePath,
  ...entryPoints,
  resolve(srcRoot, "offscreen/offscreen.html"),
  resolve(srcRoot, "popup/popup.html"),
  resolve(srcRoot, "camera-permission/camera-permission.html")
];

const requiredPublicAssets = [
  resolve(publicRoot, "models/face_landmarker.task"),
  resolve(publicRoot, "wasm/vision_wasm_internal.js"),
  resolve(publicRoot, "wasm/vision_wasm_internal.wasm"),
  resolve(publicRoot, "wasm/vision_wasm_module_internal.js"),
  resolve(publicRoot, "wasm/vision_wasm_module_internal.wasm"),
  resolve(publicRoot, "wasm/vision_wasm_nosimd_internal.js"),
  resolve(publicRoot, "wasm/vision_wasm_nosimd_internal.wasm"),
  resolve(publicRoot, "models/webeyetrack/web/model.json"),
  resolve(
    publicRoot,
    "models/webeyetrack/web/group1-shard1of1.bin"
  ),
  resolve(
    publicRoot,
    "vendor/onnxruntime/VENDOR.json"
  ),
  resolve(
    publicRoot,
    "vendor/onnxruntime/ort.webgpu.bundle.min.mjs"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.mjs"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.wasm"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.mjs"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.wasm"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.mjs"
  ),
  resolve(
    publicRoot,
    "wasm/onnxruntime/ort-wasm-simd-threaded.wasm"
  )
];

const staticSourceExtensions =
  new Set([".html", ".css"]);

const allowUnprovisionedWebEyeTrack =
  process.argv.includes(
    "--allow-unprovisioned-webeyetrack"
  );

const allowUnprovisionedL2cs =
  process.argv.includes(
    "--allow-unprovisioned-l2cs"
  );

const requiredL2csAssets = [
  resolve(
    publicRoot,
    "models/l2cs/l2cs_resnet50_gaze360.onnx"
  ),
  resolve(
    publicRoot,
    "models/l2cs/l2cs_resnet50_gaze360.contract.json"
  )
];

async function exists(
  path
) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertFilesExist(
  paths,
  label
) {
  const missing = [];

  for (const path of paths) {
    if (!(await exists(path))) {
      missing.push(
        relative(root, path)
      );
    }
  }

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `${label} missing:\n${missing.map((path) => `- ${path}`).join("\n")}`
  );
}

async function assertWebEyeTrackRuntimeProvisioned() {
  if (allowUnprovisionedWebEyeTrack) {
    return;
  }

  const runtimePath =
    resolve(
      srcRoot,
      "vendor/webeyetrack/runtime.cjs"
    );

  await assertFilesExist(
    [runtimePath],
    "Required WebEyeTrack runtime"
  );

  const runtimeSource =
    await readFile(
      runtimePath,
      "utf8"
    );

  if (
    runtimeSource.includes(
      "__WEBEYETRACK_VENDOR_STUB__"
    )
  ) {
    throw new Error(
      "WebEyeTrack runtime is still the development stub. Run `npm run vendor:webeyetrack` before building."
    );
  }
}

async function copyStaticSourceFiles(
  directory = srcRoot
) {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true
      }
    );

  for (const entry of entries) {
    const sourcePath =
      resolve(
        directory,
        entry.name
      );

    if (entry.isDirectory()) {
      await copyStaticSourceFiles(
        sourcePath
      );
      continue;
    }

    if (
      !staticSourceExtensions.has(
        extname(entry.name)
      )
    ) {
      continue;
    }

    const outputPath =
      resolve(
        distRoot,
        relative(srcRoot, sourcePath)
      );

    await mkdir(
      dirname(outputPath),
      {
        recursive: true
      }
    );

    await copyFile(
      sourcePath,
      outputPath
    );
  }
}

async function copyPublicAssets() {
  await cp(
    publicRoot,
    distRoot,
    {
      recursive: true,
      force: true,
      filter: (source) =>
        !source.endsWith(".DS_Store")
    }
  );
}

/**
 * webeyetrack@0.0.2's published browser bundle resolves BlazeGaze assets
 * from the extension-origin `/web/` directory. Our canonical research asset
 * location remains `models/webeyetrack/web/`; the build emits a compatibility
 * copy only in dist so source assets are not duplicated or moved.
 *
 * Keep this compatibility layer isolated here. If the pinned vendor runtime
 * is replaced with a build that reliably honors an injected model base URL,
 * this function and the matching dist validation entries can be removed.
 */
async function copyWebEyeTrackRuntimeCompatibilityAssets() {
  const sourceModelJson =
    resolve(
      publicRoot,
      "models/webeyetrack/web/model.json"
    );

  const sourceModelWeights =
    resolve(
      publicRoot,
      "models/webeyetrack/web/group1-shard1of1.bin"
    );

  const sourceAssetsExist =
    (await exists(sourceModelJson))
    && (await exists(sourceModelWeights));

  if (!sourceAssetsExist) {
    if (allowUnprovisionedWebEyeTrack) {
      return;
    }

    throw new Error(
      "WebEyeTrack compatibility assets are missing. Run `npm run vendor:webeyetrack` before building."
    );
  }

  const runtimeWebRoot =
    resolve(distRoot, "web");

  await mkdir(
    runtimeWebRoot,
    {
      recursive: true
    }
  );

  await Promise.all([
    copyFile(
      sourceModelJson,
      resolve(runtimeWebRoot, "model.json")
    ),
    copyFile(
      sourceModelWeights,
      resolve(
        runtimeWebRoot,
        "group1-shard1of1.bin"
      )
    )
  ]);
}

async function copyManifest() {
  const source =
    await readFile(
      manifestSourcePath,
      "utf8"
    );

  // Parse before copying so malformed JSON fails the build immediately.
  JSON.parse(source);

  await writeFile(
    manifestOutputPath,
    source,
    "utf8"
  );
}

function collectManifestRuntimePaths(
  manifest
) {
  const paths = [];

  const backgroundPath =
    manifest.background?.service_worker;

  if (typeof backgroundPath === "string") {
    paths.push(backgroundPath);
  }

  const popupPath =
    manifest.action?.default_popup;

  if (typeof popupPath === "string") {
    paths.push(popupPath);
  }

  if (Array.isArray(manifest.content_scripts)) {
    for (const scriptGroup of manifest.content_scripts) {
      if (!Array.isArray(scriptGroup?.js)) {
        continue;
      }

      for (const scriptPath of scriptGroup.js) {
        if (typeof scriptPath === "string") {
          paths.push(scriptPath);
        }
      }
    }
  }

  return paths;
}

async function validateDist() {
  const manifest =
    JSON.parse(
      await readFile(
        manifestOutputPath,
        "utf8"
      )
    );

  const requiredDistPaths = [
    ...collectManifestRuntimePaths(
      manifest
    ),
    "offscreen/offscreen.html",
    "offscreen/offscreen.js",
    "popup/popup.js",
    "camera-permission/camera-permission.html",
    "camera-permission/camera-permission.js",
    "models/face_landmarker.task",
    "vendor/onnxruntime/VENDOR.json",
    "vendor/onnxruntime/ort.webgpu.bundle.min.mjs",
    "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.mjs",
    "wasm/onnxruntime/ort-wasm-simd-threaded.jsep.wasm",
    "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.mjs",
    "wasm/onnxruntime/ort-wasm-simd-threaded.asyncify.wasm",
    "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.mjs",
    "wasm/onnxruntime/ort-wasm-simd-threaded.jspi.wasm",
    "wasm/onnxruntime/ort-wasm-simd-threaded.mjs",
    "wasm/onnxruntime/ort-wasm-simd-threaded.wasm",
    "models/webeyetrack/web/model.json",
    "models/webeyetrack/web/group1-shard1of1.bin",
    // Compatibility paths required by the published webeyetrack@0.0.2 bundle.
    "web/model.json",
    "web/group1-shard1of1.bin",
    "wasm/vision_wasm_internal.js",
    "wasm/vision_wasm_internal.wasm"
  ];

  const missing = [];

  for (const path of requiredDistPaths) {
    const absolutePath =
      resolve(distRoot, path);

    if (!(await exists(absolutePath))) {
      missing.push(path);
    }
  }

  if (
    allowUnprovisionedWebEyeTrack
  ) {
    const vendorAssetPaths =
      new Set([
        "models/webeyetrack/web/model.json",
        "models/webeyetrack/web/group1-shard1of1.bin",
        "web/model.json",
        "web/group1-shard1of1.bin"
      ]);

    const nonVendorMissing =
      missing.filter(
        (path) =>
          !vendorAssetPaths.has(path)
      );

    if (nonVendorMissing.length > 0) {
      throw new Error(
        `Built extension is incomplete:\n${nonVendorMissing.map((path) => `- dist/${path}`).join("\n")}`
      );
    }
  } else if (missing.length > 0) {
    throw new Error(
      `Built extension is incomplete:\n${missing.map((path) => `- dist/${path}`).join("\n")}`
    );
  }

  const manifestStats =
    await stat(manifestOutputPath);

  if (manifestStats.size === 0) {
    throw new Error(
      "dist/manifest.json is empty."
    );
  }
}

async function runBuild() {
  await assertFilesExist(
    requiredSourceFiles,
    "Required extension source file"
  );

  if (!allowUnprovisionedWebEyeTrack) {
    await assertFilesExist(
      requiredPublicAssets,
      "Required local model/WASM asset"
    );
  } else {
    const nonVendorAssets =
      requiredPublicAssets.filter(
        (path) =>
          !path.includes(
            "/models/webeyetrack/web/"
          )
      );

    await assertFilesExist(
      nonVendorAssets,
      "Required local MediaPipe asset"
    );
  }

  await assertWebEyeTrackRuntimeProvisioned();

  if (!allowUnprovisionedL2cs) {
    await assertFilesExist(
      requiredL2csAssets,
      "Required research L2CS model asset"
    );
  }

  await rm(
    distRoot,
    {
      recursive: true,
      force: true
    }
  );

  await mkdir(
    distRoot,
    {
      recursive: true
    }
  );

  // Background, Offscreen, Popup and camera-permission are true ES-module contexts. Building
  // them together allows shared code and the lazy WebEyeTrack runtime to be
  // split into extension-local chunks.
  await build({
    entryPoints: moduleEntryPoints,
    outdir: distRoot,
    outbase: srcRoot,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["chrome116"],
    entryNames: "[dir]/[name]",
    chunkNames: "chunks/[name]-[hash]",
    sourcemap: true,
    logLevel: "info"
  });

  // Manifest-declared content scripts are classic scripts in Chrome. Bundle
  // them separately as an IIFE so no top-level ESM import/export syntax leaks
  // into dist/content/contentScript.js. Future content modules may freely use
  // TypeScript imports because esbuild will inline them into this bundle.
  await build({
    entryPoints: [contentScriptEntryPoint],
    outfile: resolve(
      distRoot,
      "content/contentScript.js"
    ),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome116"],
    sourcemap: true,
    logLevel: "info"
  });

  await Promise.all([
    copyManifest(),
    copyPublicAssets(),
    copyStaticSourceFiles(),
    (async () => {
      await mkdir(resolve(distRoot, "uxds"), { recursive: true });
      await copyFile(resolve(srcRoot, "uxds/mouseContent.js"), resolve(distRoot, "uxds/mouseContent.js"));
    })()
  ]);

  // The pinned npm runtime still requests `/web/model.json`. Emit a dist-only
  // compatibility copy while keeping the canonical project assets under
  // `models/webeyetrack/web/`.
  await copyWebEyeTrackRuntimeCompatibilityAssets();

  await validateDist();

  if (!allowUnprovisionedL2cs) {
    await assertFilesExist(
      requiredL2csAssets.map(
        (path) =>
          resolve(
            distRoot,
            relative(publicRoot, path)
          )
      ),
      "Built research L2CS model asset"
    );
  }

  console.log(
    `Chrome extension build completed: ${relative(root, distRoot)}/`
  );

  if (allowUnprovisionedWebEyeTrack) {
    console.warn(
      "Build used --allow-unprovisioned-webeyetrack. This output is for build-pipeline verification only and must not be loaded for real gaze tracking."
    );
  }

  if (allowUnprovisionedL2cs) {
    console.warn(
      "Build used --allow-unprovisioned-l2cs. Deep shadow inference will be unavailable until the local L2CS ONNX model is exported into public/models/l2cs/."
    );
  }
}

await runBuild();
