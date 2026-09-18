-- Tiny local-only fixture for scripts/backup-roundtrip.sh.
-- Not production data. Do not copy these emails or UUIDs into a hosted project.
-- Deletes the same ids first so a second run on an already-seeded source works.
-- Replica role skips the last-owner guard; this fixture is not an offboarding path.

set session_replication_role = replica;

delete from app.assignments where id = '60000000-0000-4000-8000-000000000001';
delete from app.projects where id = '50000000-0000-4000-8000-000000000001';
delete from app.people where id in (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
);
delete from app.organization_memberships where id in (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002'
);
delete from app.webhook_outbox
 where organization_id = '20000000-0000-4000-8000-000000000001';
delete from app.audit_events
 where organization_id = '20000000-0000-4000-8000-000000000001';
delete from app.organizations where id = '20000000-0000-4000-8000-000000000001';
delete from auth.users where id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

set session_replication_role = origin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'owner-a@backup-roundtrip.local', '{"full_name":"Owner A"}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'planner-a@backup-roundtrip.local', '{"full_name":"Planner A"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '20000000-0000-4000-8000-000000000001',
  'Backup Roundtrip',
  'backup-roundtrip',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.organization_memberships (
  id, organization_id, user_id, role, status, created_by, updated_by
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'owner', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'planner', 'active',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  );

insert into app.people (
  id, organization_id, initials, name, role_title, department, location, created_by, updated_by
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'OA', 'Owner A', 'Owner', 'Planning', 'Tokyo',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'PA', 'Planner A', 'Planner', 'Planning', 'Tokyo',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
  );

insert into app.projects (
  id, organization_id, code, name, status, owner_person_id,
  start_date, end_date, created_by, updated_by
) values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'BKP1',
  'Roundtrip Probe',
  '進行中',
  '40000000-0000-4000-8000-000000000001',
  '2026-04-01',
  '2027-03-31',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into app.assignments (
  id, organization_id, person_id, project_id,
  start_date, end_date, allocation_percent, status, created_by, updated_by
) values (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  '2026-04-01',
  '2026-09-30',
  40,
  'confirmed',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
