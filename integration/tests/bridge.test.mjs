import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const storage = {};
const runtimeHandlers = [];
const sentToTabs = [];
const posted = [];
const noopEvent = { addListener() {} };

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of (typeof keys === 'string' ? [keys] : keys)) {
          if (Object.hasOwn(storage,key)) result[key] = storage[key];
        }
        return result;
      },
      async set(value) { Object.assign(storage,value); },
    },
  },
  alarms: { async create() {}, onAlarm: noopEvent },
  tabs: {
    async query() { return [{id:12,url:'https://example.com',title:'Example'}]; },
    async get(id) {return {id,url:'https://example.com',title:'Example'};},
    async sendMessage(tabId, message) {sentToTabs.push({tabId,message});return {success:true};},
    onRemoved: noopEvent,
  },
  runtime: {onInstalled:noopEvent,onStartup:noopEvent,onMessage:{addListener(fn){runtimeHandlers.push(fn)}}},
};
globalThis.fetch = async (url, init) => {
  posted.push({url,body:JSON.parse(init.body)});
  if (url.includes('validate-project')) return {ok:true,json:async()=>({valid:true,project:{id:'prj_012345abcdef',name:'UX test'}})};
  if (!/^session_\d{13}_[a-z0-9]{8}$/.test(JSON.parse(init.body).session_id)) {
    return {ok:false,status:400,json:async()=>({error:'Invalid session ID.'})};
  }
  return {ok:true,json:async()=>({success:true})};
};
const path = pathToFileURL(resolve('src/background/uxdsMouseBridge.js')).href;
const bridge = await import(path);
async function runtime(type,payload={}, sender={}) {
  for (const handler of runtimeHandlers) {
    const response = await new Promise((resolveResponse) => {
      const open = handler({type,...payload},sender,resolveResponse);
      if (!open) resolveResponse(undefined);
    });
    if (response !== undefined) return response;
  }
  throw new Error(`Message unhandled: ${type}`);
}

test('project binding, explicit arm, and strictly gated activation share the eye session',async()=>{
  const bound = await runtime('UXDS_CONNECT_PROJECT',{projectId:'prj_012345abcdef'});
  assert.equal(bound.projectId,'prj_012345abcdef');
  assert.equal(bound.isTracking,false);
  assert.equal(sentToTabs.length,0);
  const armed = await runtime('UXDS_ARM_COLLECTION');
  assert.equal(armed.uxdsArmed,true);
  assert.equal(armed.isTracking,false);
  assert.equal(sentToTabs.length,0);
  const running = await bridge.uxdsActivateForEyeSession('session_1760000000000_abc12345',12,'pv_1760000000000_fbc12345');
  assert.equal(running.success,true);
  assert.equal(running.sessionId,'session_1760000000000_abc12345');
  assert.ok(sentToTabs.some((m)=>m.message.type==='UXDS_MOUSE_START' && m.message.pageViewId==='pv_1760000000000_fbc12345'));
});

test('gaze batches and page navigation keep unified session and page identity',async()=>{
  bridge.uxdsSyncPageContext(12,'pv_1760000000001_fbc12345','session_1760000000000_abc12345');
  assert.ok(sentToTabs.some((m)=>m.message.type==='UXDS_MOUSE_PAGE_CHANGED' && m.message.pageViewId==='pv_1760000000001_fbc12345'));
  for(let i=0;i<25;i++) bridge.uxdsQueueGazeEvent({event_id:`eye_evt_${i}`,session_id:'session_1760000000000_abc12345',timestamp:Date.now(),event_type:'gaze',x:i,y:i});
  await new Promise((resolvePromise)=>setTimeout(resolvePromise,120));
  const eyeBatches = posted.filter((req)=>req.url.includes('ingest-eye-events'));
  assert.ok(eyeBatches.length>=1);
  assert.equal(eyeBatches[0].body.session_id,'session_1760000000000_abc12345');
  assert.equal(eyeBatches[0].body.events.length,25);
  assert.equal(eyeBatches[0].body.events[0].x,0);
});

test('stop ends mouse session, disarms, and preserves same eye session id',async()=>{
  const stopped = await bridge.uxdsStopForEye();
  assert.equal(stopped.success,true);
  assert.equal(stopped.uxdsArmed,false);
  assert.equal(stopped.isTracking,false);
  const stoppedMessages = sentToTabs.filter((m)=>m.message.type==='UXDS_MOUSE_STOP');
  assert.equal(stoppedMessages.length,1);
  const sessionEnd = posted.find((req)=>req.url.includes('ingest-mouse-events') && req.body.events.some((e)=>e.event_type==='session_end'));
  assert.ok(sessionEnd);
  assert.equal(sessionEnd.body.session_id,'session_1760000000000_abc12345');
});

test('mouse events from an untracked tab are rejected', async () => {
  const response = await runtime('UXDS_QUEUE_EVENTS', {payload:{project_id:'prj_012345abcdef',session_id:'rogue',events:[{event_id:'rogue'}]}}, {tab:{id:987}});
  assert.equal(response.success,false);
});

test('an unreachable eye API keeps samples in a persistent outbox for retry',async()=>{
  await runtime('UXDS_ARM_COLLECTION');
  await bridge.uxdsActivateForEyeSession('session_1760000000002_abc12345',12,'pv_1760000000002_fbc12345');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async(url,init) => {
    if (url.includes('ingest-eye-events')) throw new Error('simulated network outage');
    return originalFetch(url,init);
  };
  for (let i=0;i<25;i++) bridge.uxdsQueueGazeEvent({event_id:`persist_eye_${i}`,session_id:'session_1760000000002_abc12345',event_type:'gaze',timestamp:Date.now(),gaze_quality:0.7});
  await new Promise((resolvePromise)=>setTimeout(resolvePromise,130));
  const offline = await bridge.uxdsGetState();
  assert.equal(offline.eyePendingEventCount,25);
  assert.match(offline.lastUploadError,/simulated network outage/);
  globalThis.fetch = originalFetch;
  await runtime('UXDS_RETRY_UPLOAD');
  const restored = await bridge.uxdsGetState();
  assert.equal(restored.eyePendingEventCount,0);
  await bridge.uxdsStopForEye();
});


test('validated project can activate simultaneous collection after network drops during calibration', async () => {
  const armed = await runtime('UXDS_ARM_COLLECTION');
  assert.equal(armed.uxdsArmed,true);
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline after calibration'); };
  const started = await bridge.uxdsActivateForEyeSession('session_1760000000003_abc12345',12,'pv_1760000000003_fbc12345');
  assert.equal(started.success,true);
  assert.equal(started.sessionId,'session_1760000000003_abc12345');
  const tracked = sentToTabs.filter(m=>m.message.type==='UXDS_MOUSE_START').at(-1);
  assert.equal(tracked.message.sessionId,'session_1760000000003_abc12345');
  await bridge.uxdsStopForEye();
  globalThis.fetch = before;
});


test('legacy session UUID outbox is replayed with one stable server ID across mouse and eye without mutating raw queue', async () => {
  await new Promise(resolve => setTimeout(resolve, 35));
  await runtime('UXDS_RETRY_UPLOAD');
  const legacy = 'session_8f73f115-b8e7-46e5-8d3d-b1aeb7b18277';
  const legacyPage = 'page_a3e602c9-7b62-46da-a510-55178266cc66';
  const timestamp = Date.now();
  const mouseEvent = {event_id:'move_abc12345',project_id:'prj_012345abcdef',session_id:legacy,
    page_view_id:legacyPage,event_type:'mousemove',timestamp,x:42};
  const eyeEvent = {event_id:'gaze_abc12345',session_id:legacy,page_id:legacyPage,event_type:'gaze',timestamp,gaze_quality:0.9};
  const mouseBatch = {batchId:'legacy_mouse',project_id:'prj_012345abcdef',session_id:legacy,
    events:[mouseEvent],queuedAt:timestamp,attempts:1};
  const eyeBatch = {batchId:'legacy_eye',project_id:'prj_012345abcdef',session_id:legacy,
    events:[eyeEvent],queuedAt:timestamp,attempts:1};
  storage.pendingUploadBatches = [mouseBatch];
  storage.eyeUploadQueue = [eyeBatch];
  const previousLength = posted.length;
  const result = await runtime('UXDS_RETRY_UPLOAD');
  assert.equal(result.success,true);
  const replayed = posted.slice(previousLength);
  const mouse = replayed.find((req)=>req.url.includes('ingest-mouse-events'))?.body;
  const eye = replayed.find((req)=>req.url.includes('ingest-eye-events'))?.body;
  assert.ok(mouse && eye);
  assert.match(mouse.session_id,/^session_\d{13}_[a-z0-9]{8}$/);
  assert.equal(mouse.session_id,eye.session_id);
  assert.equal(mouse.events[0].session_id,eye.events[0].session_id);
  assert.equal(mouse.events[0].page_view_id,eye.events[0].page_id);
  assert.match(mouse.events[0].page_view_id,/^pv_\d{13}_[a-z0-9]{8}$/);
  assert.equal(mouse.events[0].event_id,mouseEvent.event_id);
  assert.equal(eye.events[0].event_id,eyeEvent.event_id);
  assert.equal(mouseEvent.session_id,legacy);
  assert.equal(eyeEvent.page_id,legacyPage);
  assert.equal(storage.pendingUploadBatches.length,0);
  assert.equal(storage.eyeUploadQueue.length,0);
  assert.equal(storage.uxdsUploadIdAliasesV1[`session:${legacy}`],mouse.session_id);
  assert.equal(storage.uxdsUploadIdAliasesV1[`page:${legacyPage}`],eye.events[0].page_id);
});

test('server 400 refuses upload but never deletes batch',async()=>{
  const malformed = { batchId:'malformed',project_id:'prj_012345abcdef',session_id:'bad_session',
    events:[{event_id:'move_abc00000',session_id:'bad_session',event_type:'mousemove',timestamp:Date.now()}],
    queuedAt:Date.now(), attempts:0 };
  storage.pendingUploadBatches = [malformed];
  const result = await runtime('UXDS_RETRY_UPLOAD');
  assert.equal(result.success,false);
  assert.equal(storage.pendingUploadBatches.length,1);
  assert.equal(storage.pendingUploadBatches[0].batchId,'malformed');
  storage.pendingUploadBatches = [];
});
