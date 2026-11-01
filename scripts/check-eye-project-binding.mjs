import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const edge = readFileSync(new URL('../supabase/functions/ingest-eye-events/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261018_uxds_eye_events.sql', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../integration/uxds-dashboard-query.ts', import.meta.url), 'utf8');

assert.match(edge, /\.eq\('public_id', projectId\)/, 'Look up external IDs by public_id');
assert.doesNotMatch(edge, /\.eq\('id', projectId\)/, 'Do not compare public ID to UUID column');
assert.match(edge, /event_id: id, project_id: project\.id, session_id: sessionId/, 'Store the canonical project UUID');
assert.match(migration, /project_id text not null/, 'Existing deployed column remains compatible');
assert.match(dashboard, /\.eq\('project_id',projectUuid\)/, 'Dashboard joins using projects.id');
console.log('Eye project public_id -> UUID mapping checks: 5 passed.');
