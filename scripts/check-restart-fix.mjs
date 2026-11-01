import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const files = ['src/content/contentScript.ts','src/background/serviceWorker.ts','src/popup/popup.ts'];
for (const f of files) {
  const src=readFileSync(f,'utf8');
  const tsSource=ts.createSourceFile(f,src,ts.ScriptTarget.Latest,true);
  assert.equal(tsSource.parseDiagnostics.length,0,`${f} syntax parse errors: ${tsSource.parseDiagnostics.map(d=>d.messageText)}`);
}
const source=readFileSync('src/background/serviceWorker.ts','utf8');
assert(source.includes('&& isCalibrationFlowRestartState('));
assert(!source.includes('details.transitionType\n            === "reload"'));
assert(source.includes('pendingCalibrationUiReadySignals.clear();'));
const popup=readFileSync('src/popup/popup.ts','utf8');
assert(!popup.includes('await resetTracker().catch(() => undefined);\n      await refreshTrackerState();'));
assert(popup.includes('const previousState = await refreshTrackerState();'));
assert(popup.includes('await resetTracker();\n      const resetState = await refreshTrackerState();'));
assert(popup.includes('if (resetState !== TRACKER_STATES.IDLE)'));
const content=readFileSync('src/content/contentScript.ts','utf8');
assert(content.includes('rawMessage.type === MESSAGE_TYPES.PING'));
const a=source.indexOf('async function ensureResearchContentScriptsInjected(');
const b=source.indexOf('async function forwardStartCalibrationToContent(',a);
const snippet=source.slice(a,b);
const js=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
let checks=0;
for (const [eyeAlive,mouseAlive,expectFiles] of [[true,true,[]],[false,true,['content/contentScript.js']],[true,false,['uxds/mouseContent.js']],[false,false,['content/contentScript.js','uxds/mouseContent.js']]]) {
  const injected=[];
  const messages=[];
  const env={
    MESSAGE_TYPES:{PING:'PING',PONG:'PONG'},
    createMessageId:()=> 'nonce',
    nowEpochMs:()=> 123,
    createRuntimeMessage:(type,meta,payload)=>({type,protocolVersion:5,meta,payload}),
    isRecord:(value)=>value!==null && typeof value==='object',
    isCompatibleMessageProtocol:(v)=>v===5,
    logger:{info:()=>{}},
    chrome:{
      tabs:{sendMessage:async(_tab,msg)=>{
        messages.push(msg.type);
        if(msg.type==='PING')return eyeAlive? {protocolVersion:5,type:'PONG',meta:{source:'CONTENT'},payload:{nonce:msg.payload.nonce}}:undefined;
        if(msg.type==='UXDS_PING')return mouseAlive? {success:true}:undefined;
        throw new Error('unexpected');
      }},
      scripting:{executeScript:async({files})=>{injected.push(...files)}}
    }
  };
  vm.createContext(env);
  vm.runInContext(js,env);
  await vm.runInContext(`ensureResearchContentScriptsInjected({tabId:1,sessionId:'s',currentPageId:'p'})`,env);
  assert.deepEqual(injected,expectFiles);
  assert.deepEqual(messages,['PING','UXDS_PING']);
  checks++;
}
console.log(`PASS: 3 TypeScript source syntax checks + 4 content-injection regression cases + 4 restart invariants (${checks} scenarios).`);
