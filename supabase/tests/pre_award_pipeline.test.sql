begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000021', 'pipeline-owner@test.local', '{"full_name":"Pipeline Owner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000021',
  'Pipeline Tenant',
  'pipeline-tenant-test',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  'owner',
  'active',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.people (
  id, organization_id, initials, name, role_title, department, avatar_tone,
  location, capacity_percent, created_by, updated_by
) values (
  '61000000-0000-4000-8000-000000000021',
  '21000000-0000-4000-8000-000000000021',
  'PO',
  'Pipeline Owner',
  'Project Manager',
  '事業推進',
  'mint',
  'Tokyo',
  100,
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.opportunities (
  id, organization_id, code, name, summary, stage, start_date, end_date,
  demand_headcount, owner_person_id, created_by, updated_by
) values (
  '81000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000021',
  'NWD',
  'Northwind',
  'Pre-award pipeline coverage',
  'inquiry',
  '2026-09-01',
  '2026-12-31',
  4,
  '61000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

insert into app.opportunity_needs (
  id, organization_id, opportunity_id, role_title, start_date, end_date,
  allocation_percent, created_by, updated_by
) values (
  '82000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000021',
  '81000000-0000-4000-8000-000000000001',
  'Frontend Engineer',
  '2026-09-01',
  '2026-12-18',
  60,
  '11000000-0000-4000-8000-000000000021',
  '11000000-0000-4000-8000-000000000021'
);

select throws_ok(
  $$insert into app.opportunities (
      organization_id, code, name, stage, start_date, end_date, demand_headcount, converted_project_id
    ) values (
      '21000000-0000-4000-8000-000000000021',
      'BAD',
      'Won without project',
      'won',
      '2026-09-01',
      '2026-12-31',
      1,
      null
    )$$,
  '23514',
  null,
  'won opportunities require a converted project'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000021';

select ok(
  (select jsonb_array_length(public.get_workspace('21000000-0000-4000-8000-000000000021') -> 'opportunities') = 1),
  'get_workspace includes opportunities'
);

select is(
  (
    select item ->> 'stage'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000021') -> 'opportunities') as item
    where item ->> 'name' = 'Northwind'
  ),
  'inquiry',
  'get_workspace returns opportunity stage'
);

select is(
  (
    select item ->> 'role'
    from jsonb_array_elements(public.get_workspace('21000000-0000-4000-8000-000000000021') -> 'opportunityNeeds') as item
  ),
  'Frontend Engineer',
  'get_workspace returns opportunity staffing plans'
);

reset role;

select has_function(
  'private',
  'apply_opportunities',
  array['uuid', 'jsonb', 'uuid'],
  'opportunity apply helper exists'
);

select has_function(
  'private',
  'apply_opportunity_needs',
  array['uuid', 'jsonb', 'uuid'],
  'opportunity need apply helper exists'
);

select has_table('app', 'opportunities', 'opportunities table exists');
select has_table('app', 'opportunity_needs', 'opportunity needs table exists');

select * from finish();
rollback;
