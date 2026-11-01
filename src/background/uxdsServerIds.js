/**
 * UXDS mouse Edge Function expects the original extension's legacy public IDs:
 *   session_<epoch-ms>_<8 base36 chars>
 *   pv_<epoch-ms>_<8 base36 chars>
 * The research eye engine historically used session_<UUID> / page_<UUID>.
 * Only the upload representation is translated, so existing research rows and
 * already queued data are not rewritten or discarded.
 */
export const UXDS_SESSION_ID_RE = /^session_\d{13}_[a-z0-9]{8}$/;
export const UXDS_PAGE_VIEW_ID_RE = /^pv_\d{13}_[a-z0-9]{8}$/;

export function isUxdsServerSessionId(value) {
  return typeof value === 'string' && UXDS_SESSION_ID_RE.test(value);
}

export function isUxdsServerPageViewId(value) {
  return typeof value === 'string' && UXDS_PAGE_VIEW_ID_RE.test(value);
}

function randomSuffix() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

export function makeUxdsServerSessionId(time = Date.now()) {
  return `session_${Math.trunc(time)}_${randomSuffix()}`;
}

export function makeUxdsServerPageViewId(time = Date.now()) {
  return `pv_${Math.trunc(time)}_${randomSuffix()}`;
}

/** Only support known eye-engine ID formats for legacy queue translation. */
export function isLegacyEyeSessionId(value) {
  return typeof value === 'string' && /^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isLegacyEyePageId(value) {
  return typeof value === 'string' && /^page_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function toUxdsUploadEvent(event, sessionId, pageViewId = null) {
  const updated = { ...event, session_id: sessionId };
  if (pageViewId !== null) {
    if (typeof event.page_view_id === 'string') updated.page_view_id = pageViewId;
    if (typeof event.page_id === 'string') updated.page_id = pageViewId;
  }
  return updated;
}
