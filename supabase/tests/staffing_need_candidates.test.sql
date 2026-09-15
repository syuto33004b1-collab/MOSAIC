begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Candidates kept on a staffing need (#324).
select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000324', 'cand-owner@test.local', '{"full_name":"Cand Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000325', 'cand-planner@test.local', '{"full_name":"Cand Planner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000324',
  'Candidate Tenant',
  'candidate-tenant-test',
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  (
    '21000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324',
    'owner', 'active',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  ),
  (
    '21000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000325',
    'planner', 'active',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  );

insert into app.people (
  id, organization_id, user_id, initials, name, role_title, department,
  location, created_by, updated_by
) values
  (
    '61000000-0000-4000-8000-000000000324',
    '21000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324',
    'CO', 'Owner Person', 'Engineer', 'Operations', 'Tokyo',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  ),
  (
    '61000000-0000-4000-8000-000000000325',
    '21000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000325',
    'CP', 'Planner Person', 'Engineer', 'Operations', 'Tokyo',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  ),
  (
    '61000000-0000-4000-8000-000000000326',
    '21000000-0000-4000-8000-000000000324',
    null,
    'HD', 'Hidden Person', 'Engineer', 'Other', 'Tokyo',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  ),
  (
    '61000000-0000-4000-8000-000000000327',
    '21000000-0000-4000-8000-000000000324',
    null,
    'AR', 'Archived Person', 'Engineer', 'Operations', 'Tokyo',
    '11000000-0000-4000-8000-000000000324',
    '11000000-0000-4000-8000-000000000324'
  );

update app.people
set is_active = false
where id = '61000000-0000-4000-8000-000000000327';

insert into app.role_permissions (
  organization_id, role, person_scope, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000324',
  'planner',
  'self',
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
);

insert into app.projects (
  id, organization_id, code, name, status, tone, owner_person_id,
  start_date, end_date, progress_percent, demand_headcount, created_by, updated_by
) values (
  '62000000-0000-4000-8000-000000000324',
  '21000000-0000-4000-8000-000000000324',
  'CAND', 'Candidate Project', '進行中', 'blue',
  '61000000-0000-4000-8000-000000000324',
  current_date, current_date + 30, 10, 1,
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
);

insert into app.staffing_needs (
  id, organization_id, project_id, role_title, start_date, end_date,
  allocation_percent, status, created_by, updated_by
) values (
  '63000000-0000-4000-8000-000000000324',
  '21000000-0000-4000-8000-000000000324',
  '62000000-0000-4000-8000-000000000324',
  'Engineer', current_date, current_date + 30, 40, 'open',
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, location, created_by, updated_by
)
select
  ('71000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '21000000-0000-4000-8000-000000000324',
  'P' || n::text,
  'Cap Person ' || n::text,
  'Engineer',
  'Operations',
  'Tokyo',
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
from generate_series(1, 13) as n;

select has_table('app', 'staffing_need_candidates', 'the candidates table exists');

select has_function(
  'private',
  'apply_staffing_need_candidates',
  array['uuid', 'jsonb', 'uuid'],
  'the candidates apply helper exists'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000324';

select is(
  (
    select item -> 'candidatePersonIds'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000324') -> 'needs'
    ) as item
    where item ->> 'id' = '63000000-0000-4000-8000-000000000324'
  ),
  '[]'::jsonb,
  'get_workspace returns an empty candidate array when there are no rows'
);

select public.save_workspace(
  '21000000-0000-4000-8000-000000000324',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
  gen_random_uuid(),
  jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '63000000-0000-4000-8000-000000000324',
      'projectId', '62000000-0000-4000-8000-000000000324',
      'role', 'Engineer',
      'skills', '[]'::jsonb,
      'startDate', current_date::text,
      'endDate', (current_date + 30)::text,
      'allocation', 40,
      'status', 'open',
      'candidatePersonIds', jsonb_build_array(
        '61000000-0000-4000-8000-000000000325',
        '61000000-0000-4000-8000-000000000326'
      )
    )
  ))),
  repeat('0', 64)
);

select is(
  (
    select item -> 'candidatePersonIds'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000324') -> 'needs'
    ) as item
    where item ->> 'id' = '63000000-0000-4000-8000-000000000324'
  ),
  jsonb_build_array(
    '61000000-0000-4000-8000-000000000325',
    '61000000-0000-4000-8000-000000000326'
  ),
  'get_workspace returns saved candidate ids in order'
);

reset role;

insert into app.staffing_need_candidates (
  organization_id, staffing_need_id, person_id, sort_order, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000324',
  '63000000-0000-4000-8000-000000000324',
  '61000000-0000-4000-8000-000000000327',
  90,
  '11000000-0000-4000-8000-000000000324',
  '11000000-0000-4000-8000-000000000324'
);

create temp table cand_created as
select person_id, created_at, created_by
from app.staffing_need_candidates
where staffing_need_id = '63000000-0000-4000-8000-000000000324'
  and person_id = '61000000-0000-4000-8000-000000000325';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000324';

select is(
  (
    select item -> 'candidatePersonIds'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000324') -> 'needs'
    ) as item
    where item ->> 'id' = '63000000-0000-4000-8000-000000000324'
  ),
  jsonb_build_array(
    '61000000-0000-4000-8000-000000000325',
    '61000000-0000-4000-8000-000000000326'
  ),
  'get_workspace drops archived members from the candidate array'
);

select public.save_workspace(
  '21000000-0000-4000-8000-000000000324',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
  gen_random_uuid(),
  jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '63000000-0000-4000-8000-000000000324',
      'projectId', '62000000-0000-4000-8000-000000000324',
      'role', 'Engineer',
      'skills', '[]'::jsonb,
      'startDate', current_date::text,
      'endDate', (current_date + 30)::text,
      'allocation', 40,
      'status', 'open'
    )
  ))),
  repeat('0', 64)
);

reset role;

select is(
  (
    select candidate.created_at
    from app.staffing_need_candidates as candidate
    join cand_created as previous
      on previous.person_id = candidate.person_id
    where candidate.staffing_need_id = '63000000-0000-4000-8000-000000000324'
  ),
  (select created_at from cand_created),
  'omitting the key leaves created_at alone'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000324';

select throws_ok(
  $sql$select public.save_workspace(
    '21000000-0000-4000-8000-000000000324',
    (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
    gen_random_uuid(),
    jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
      jsonb_build_object(
        'id', '63000000-0000-4000-8000-000000000324',
        'projectId', '62000000-0000-4000-8000-000000000324',
        'role', 'Engineer',
        'skills', '[]'::jsonb,
        'startDate', current_date::text,
        'endDate', (current_date + 30)::text,
        'allocation', 40,
        'status', 'open',
        'candidatePersonIds', null
      )
    ))),
    repeat('0', 64)
  )$sql$,
  '22023',
  'needs.upsert[].candidatePersonIds must be a JSON array',
  'null is not a way to leave or clear the list'
);

select throws_ok(
  $sql$select public.save_workspace(
    '21000000-0000-4000-8000-000000000324',
    (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
    gen_random_uuid(),
    jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
      jsonb_build_object(
        'id', '63000000-0000-4000-8000-000000000324',
        'projectId', '62000000-0000-4000-8000-000000000324',
        'role', 'Engineer',
        'skills', '[]'::jsonb,
        'startDate', current_date::text,
        'endDate', (current_date + 30)::text,
        'allocation', 40,
        'status', 'open',
        'candidatePersonIds', (
          select jsonb_agg(('71000000-0000-4000-8000-' || lpad(n::text, 12, '0')))
          from generate_series(1, 13) as n
        )
      )
    ))),
    repeat('0', 64)
  )$sql$,
  '22023',
  'needs.upsert[].candidatePersonIds may have at most 12 people',
  'the write is refused when the need would hold more than 12 people'
);

reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000325';

select is(
  (
    select item -> 'candidatePersonIds'
    from jsonb_array_elements(
      public.get_workspace('21000000-0000-4000-8000-000000000324') -> 'needs'
    ) as item
    where item ->> 'id' = '63000000-0000-4000-8000-000000000324'
  ),
  jsonb_build_array('61000000-0000-4000-8000-000000000325'),
  'a self-scoped planner does not see other people in the candidate list'
);

select throws_ok(
  $sql$select public.save_workspace(
    '21000000-0000-4000-8000-000000000324',
    (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
    gen_random_uuid(),
    jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
      jsonb_build_object(
        'id', '63000000-0000-4000-8000-000000000324',
        'projectId', '62000000-0000-4000-8000-000000000324',
        'role', 'Engineer',
        'skills', '[]'::jsonb,
        'startDate', current_date::text,
        'endDate', (current_date + 30)::text,
        'allocation', 40,
        'status', 'open',
        'candidatePersonIds', jsonb_build_array('61000000-0000-4000-8000-000000000326')
      )
    ))),
    repeat('0', 64)
  )$sql$,
  '42501',
  'this role cannot keep a member outside its data scope as a candidate',
  'a self-scoped planner cannot write a person they cannot see'
);

select public.save_workspace(
  '21000000-0000-4000-8000-000000000324',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
  gen_random_uuid(),
  jsonb_build_object('needs', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object(
      'id', '63000000-0000-4000-8000-000000000324',
      'projectId', '62000000-0000-4000-8000-000000000324',
      'role', 'Engineer',
      'skills', '[]'::jsonb,
      'startDate', current_date::text,
      'endDate', (current_date + 30)::text,
      'allocation', 40,
      'status', 'open',
      'candidatePersonIds', '[]'::jsonb
    )
  ))),
  repeat('0', 64)
);

reset role;

select ok(
  exists (
    select 1
    from app.staffing_need_candidates
    where staffing_need_id = '63000000-0000-4000-8000-000000000324'
      and person_id = '61000000-0000-4000-8000-000000000326'
  ),
  '[] from a scoped planner leaves people they could not see'
);

select ok(
  exists (
    select 1
    from app.staffing_need_candidates
    where staffing_need_id = '63000000-0000-4000-8000-000000000324'
      and person_id = '61000000-0000-4000-8000-000000000327'
  ),
  '[] from a scoped planner leaves archived candidates'
);

select ok(
  not exists (
    select 1
    from app.staffing_need_candidates
    where staffing_need_id = '63000000-0000-4000-8000-000000000324'
      and person_id = '61000000-0000-4000-8000-000000000325'
  ),
  '[] from a scoped planner clears the people they could see'
);

select is(
  (
    select entity_id
    from app.audit_events
    where entity_type = 'staffing_need_candidates'
      and action = 'insert'
      and (entity_key ->> 'personId') = '61000000-0000-4000-8000-000000000325'
    order by id
    limit 1
  ),
  '63000000-0000-4000-8000-000000000324'::uuid,
  'the audit row is keyed by the staffing need, not the candidate row'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000324';

select public.save_workspace(
  '21000000-0000-4000-8000-000000000324',
  (select workspace_revision from app.organizations where id = '21000000-0000-4000-8000-000000000324'),
  gen_random_uuid(),
  jsonb_build_object('needs', jsonb_build_object(
    'upsert', '[]'::jsonb,
    'cancelIds', jsonb_build_array('63000000-0000-4000-8000-000000000324')
  )),
  repeat('0', 64)
);

reset role;

select ok(
  exists (
    select 1
    from app.staffing_need_candidates
    where staffing_need_id = '63000000-0000-4000-8000-000000000324'
  ),
  'cancelling a need does not delete its candidate rows'
);

select * from finish();
rollback;
