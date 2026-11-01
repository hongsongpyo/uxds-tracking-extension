// Deploy via: supabase functions deploy ingest-eye-events --project-ref YOUR_PROJECT_REF
// Never put the SUPABASE_SERVICE_ROLE_KEY in the Chrome Extension.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function respond(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function textOrNull(value: unknown, max = 2048): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}
function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
  // Avoid uncontrolled memory use even on malicious requests.
  if (Number(request.headers.get('content-length') || '0') > 256_000) {
    return respond(413, { error: 'payload_too_large' });
  }
  let payload: Record<string, unknown> | null;
  try { payload = objectOrNull(await request.json()); } catch { return respond(400, { error: 'invalid_json' }); }
  if (!payload) return respond(400, { error: 'invalid_payload' });
  const projectId = textOrNull(payload.project_id, 64);
  const sessionId = textOrNull(payload.session_id, 128);
  const events = payload.events;
  if (!projectId || !/^prj_[0-9a-f]{12}$/.test(projectId) || !sessionId ||
      !Array.isArray(events) || events.length === 0 || events.length > 100) {
    return respond(400, { error: 'invalid_project_session_or_batch' });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return respond(500, { error: 'server_not_configured' });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  // The Chrome Extension receives projects.public_id (prj_...), never the
  // internal UUID. Resolve it before writing. Existing UXDS mouse records use
  // projects.id (UUID), and gaze records must be joinable to those records.
  const { data: project, error: projectError } = await supabase.from('projects')
    .select('id,public_id').eq('public_id', projectId).maybeSingle();
  if (projectError) return respond(500, { error: 'project_lookup_failed' });
  if (!project) return respond(404, { error: 'project_not_found' });
  const rows = [];
  for (const entry of events) {
    const e = objectOrNull(entry);
    const id = textOrNull(e?.event_id, 128);
    const timestamp = finite(e?.timestamp);
    if (!e || !id || !/^[\w-]{8,128}$/.test(id) || e.session_id !== sessionId ||
        timestamp === null || timestamp < 1_500_000_000_000 || timestamp > Date.now() + 300_000 ||
        e.event_type !== 'gaze' || finite(e.gaze_quality) === null ||
        (e.gaze_quality as number) < 0 || (e.gaze_quality as number) > 1) {
      return respond(400, { error: 'invalid_eye_event' });
    }
    rows.push({
      // uxds_eye_events.project_id is TEXT in the existing deployment;
      // store the UUID as text to match mouse_tracking_events.project_id.
      event_id: id, project_id: project.id, session_id: sessionId,
      page_id: textOrNull(e.page_id, 128), tab_id: finite(e.tab_id),
      occurred_at: new Date(timestamp).toISOString(), client_timestamp_ms: timestamp,
      page_url: textOrNull(e.page_url, 2048),
      x: finite(e.x), y: finite(e.y), client_x: finite(e.client_x), client_y: finite(e.client_y),
      scroll_x: finite(e.scroll_x), scroll_y: finite(e.scroll_y),
      viewport_width: finite(e.viewport_width), viewport_height: finite(e.viewport_height),
      document_width: finite(e.document_width), document_height: finite(e.document_height),
      gaze_quality: e.gaze_quality, degraded_collection: e.degraded_collection === true,
      point_source: textOrNull(e.point_source, 80), primary_aoi_id: textOrNull(e.primary_aoi_id, 256),
      fixation_id: textOrNull(e.fixation_id, 128),
      raw_prediction_normalized: objectOrNull(e.raw_prediction_normalized),
      authoritative_normalized: objectOrNull(e.authoritative_normalized),
      stabilized_normalized: objectOrNull(e.stabilized_normalized),
      candidates: Array.isArray(e.candidates) ? e.candidates.slice(0, 12) : [],
    });
  }
  const { error } = await supabase.from('uxds_eye_events').upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true });
  if (error) return respond(500, { error: 'eye_insert_failed', detail: error.message });
  return respond(200, { success: true, accepted: rows.length });
});
