/** Provision MediaPipe FaceLandmarker task and the exact WASM assets locally.
 * This runs during developer setup only. Extension inference stays offline.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = '1.0.1';
const upstreamWasm = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`;
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const names = [
  'vision_wasm_internal.js', 'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'
];
const checkOnly = process.argv.includes('--check');
const wasmDir = resolve(root, 'public/wasm');
const model = resolve(root, 'public/models/face_landmarker.task');
const manifestPath = resolve(root,'public/models/mediapipe-assets.json');
async function sha256(path) {return createHash('sha256').update(await readFile(path)).digest('hex');}
async function requireAsset(path, minBytes = 1024) {
  const info = await stat(path);
  if (info.size < minBytes) throw new Error(`Incomplete asset: ${path} (${info.size} bytes)`);
  return { bytes: info.size, sha256: await sha256(path) };
}
async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
}
if (!checkOnly) {
  for (const name of names) {
    const target = resolve(wasmDir, name);
    const local = resolve(root,'node_modules/@mediapipe/tasks-vision/wasm',name);
    try { await copyFile(local,target); }
    catch { await download(`${upstreamWasm}/${name}`,target); }
  }
  await download(modelUrl,model);
}
const files = [];
for (const name of names) {
  const path = resolve(wasmDir,name);
  files.push({file:`wasm/${name}`,...await requireAsset(path)});
}
files.push({file:'models/face_landmarker.task',...await requireAsset(model,1000000)});
if (!checkOnly) {
  await writeFile(manifestPath,JSON.stringify({name:'MediaPipe Tasks Vision',version,modelSource:modelUrl,wasmSource:upstreamWasm,files},null,2)+'\n');
}
console.log('MediaPipe Face Landmarker model and 6 local WASM/JS assets verified.');
