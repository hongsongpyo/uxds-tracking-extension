/** Integrate in an existing server-protected UXDS React/Supabase data loader.
 * Do NOT expose the service-role secret in the browser. Authenticated client
 * reads need an owner-scoped RLS SELECT policy; anon reads are disabled.
 * projectUuid is projects.id, NOT the public prj_... identifier.
 * This loader is an example, not an automatic integration with the UXDS UI.
 */
export interface UnifiedPoint {
  source: 'mouse' | 'eye';
  session_id: string;
  occurred_at: string;
  event_type: string;
  x: number | null;
  y: number | null;
  gaze_quality?: number | null;
  primary_aoi_id?: string | null;
}
export async function fetchEyeEventsForProject(
  supabase: { from: (name: string) => { select: (cols: string) => { eq: (column: string, id: string) => { order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }> } } } },
  projectUuid: string,
): Promise<UnifiedPoint[]> {
  const {data,error} = await supabase.from('uxds_eye_events')
    .select('session_id,occurred_at,x,y,gaze_quality,primary_aoi_id')
    .eq('project_id',projectUuid)
    .order('occurred_at',{ascending:true});
  if (error) throw new Error(error.message);
  const values = (data ?? []) as Array<Omit<UnifiedPoint,'source'|'event_type'>>;
  return values.map(v => ({...v,source:'eye',event_type:'gaze'}));
}
