import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname,'..');
const manifest = JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
const source = await readFile(resolve(root,'src/background/serviceWorker.ts'),'utf8');
const bridge = await readFile(resolve(root,'src/background/uxdsMouseBridge.js'),'utf8');
const mouse = await readFile(resolve(root,'src/uxds/mouseContent.js'),'utf8');
const checks = [
  ['Single manifest',manifest.manifest_version === 3 && manifest.background.service_worker === 'background/serviceWorker.js'],
  ['Both content scripts',manifest.content_scripts.some(c => c.js.includes('content/contentScript.js') && c.js.includes('uxds/mouseContent.js'))],
  ['Single session ID',source.includes('uxdsActivateForEyeSession(sessionId, targetTab.tabId, targetTab.currentPageId)')],
  ['Validation-first mouse',source.indexOf('uxdsActivateForEyeSession(') > source.indexOf('selectedValidation !== null')],
  ['No isolated mouse start button',!bridge.includes('case "UXDS_MOUSE_START":')],
  ['Explicit arm',bridge.includes('UXDS_ARM_COLLECTION')],
  ['New tab support',mouse.includes('UXDS_CONTENT_READY')],
  ['Navigation support',mouse.includes('UXDS_MOUSE_PAGE_CHANGED')],
  ['Eye persistent queue',bridge.includes('eyeUploadQueue')],
  ['Gaze quality/AOI',source.includes('primary_aoi_id: sample.hit.primaryAoiId')],
  ['Eye protocol responses isolated',mouse.includes('if (!["UXDS_MOUSE_START"') && mouse.includes('return false;')],
  ['MediaPipe vendor provisioning',await access(resolve(root,'scripts/vendor-mediapipe.mjs')).then(()=>true,()=>false)],
];
for(const [name,passed] of checks){console.log(`${passed?'PASS':'FAIL'} ${name}`)}
if(checks.some(([,passed])=>!passed)) process.exitCode=1;
const binaries = [
 'public/models/face_landmarker.task',
 'public/models/webeyetrack/web/group1-shard1of1.bin',
 'public/models/l2cs/l2cs_resnet50_gaze360.onnx',
 'public/wasm/vision_wasm_internal.wasm',
 'public/wasm/onnxruntime/ort-wasm-simd-threaded.wasm'
];
for(const asset of binaries){
 const exists = await access(resolve(root,asset)).then(()=>true,()=>false);
 console.log(`${exists?'FOUND':'MISSING'} ${asset}`);
}
