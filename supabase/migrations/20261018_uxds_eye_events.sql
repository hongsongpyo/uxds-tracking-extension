-- UXDS unified Eye + Mouse data for the existing UXDS database.
-- Mouse remains in public.mouse_tracking_events (project_id uuid).
-- Eye remains in public.uxds_eye_events (project_id text containing the
-- canonical projects.id UUID string, resolved from projects.public_id).
-- The original public.gaze_tracking_events table is not altered by this migration.
-- Both streams use the SAME session_id and aligned page_id/page_view_id.
create table if not exists public.uxds_eye_events (
  event_id text primary key,
  project_id text not null, -- Canonical projects.id UUID encoded as text for existing schema compatibility.
  session_id text not null,
  page_id text,
  tab_id integer,
  occurred_at timestamptz not null,
  client_timestamp_ms bigint not null,
  page_url text,
  x double precision,
  y double precision,
  client_x double precision,
  client_y double precision,
  scroll_x double precision,
  scroll_y double precision,
  viewport_width integer,
  viewport_height integer,
  document_width integer,
  document_height integer,
  gaze_quality double precision,
  degraded_collection boolean not null default false,
  point_source text,
  primary_aoi_id text,
  fixation_id text,
  raw_prediction_normalized jsonb,
  authoritative_normalized jsonb,
  stabilized_normalized jsonb,
  candidates jsonb not null default '[]'::jsonb,
  received_at timestamptz not null default now(),
  constraint uxds_eye_quality_range check (gaze_quality is null or gaze_quality between 0 and 1)
);
create index if not exists uxds_eye_project_time_idx on public.uxds_eye_events (project_id, occurred_at);
create index if not exists uxds_eye_session_time_idx on public.uxds_eye_events (session_id, occurred_at);
create index if not exists uxds_eye_aoi_idx on public.uxds_eye_events (project_id, primary_aoi_id);

-- Only the Edge Function service role writes eye samples. Authenticated website
-- readers must also be authorized as project members through their own RLS policy.
alter table public.uxds_eye_events enable row level security;
revoke all on public.uxds_eye_events from anon, authenticated;

-- Both data streams share project_id / session_id / epoch-ms timestamps.
-- Query from the UXDS dashboard via server-side protected API, not anon access.
comment on table public.uxds_eye_events is 'UXDS gaze samples: project_id is projects.id UUID as text; join with mouse_tracking_events.project_id::text and session_id';
