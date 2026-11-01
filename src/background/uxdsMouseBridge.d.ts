export interface UxdsMouseState { success:boolean; isTracking:boolean; uxdsArmed:boolean; projectId:string|null; sessionId:string|null; projectName:string|null; pendingUploadEventCount:number; eyePendingEventCount:number; lastUploadError:string|null; }
export function uxdsActivateForEyeSession(sessionId:string, tabId:number, pageId:string):Promise<UxdsMouseState>;
export function uxdsSyncPageContext(tabId:number,pageId:string,sessionId:string):void;
export function uxdsStopForEye():Promise<unknown>;
export function uxdsArmCollection():Promise<UxdsMouseState>;
export function uxdsIsCollecting(sessionId:string):boolean;
export function uxdsQueueGazeEvent(event: Record<string,unknown>):void;
export function uxdsGetState():Promise<UxdsMouseState>;
