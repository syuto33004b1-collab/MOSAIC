begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- Evaluations of a person (#601).
select plan(44);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000651', 'eval-owner@test.local', '{"full_name":"評価 Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000652', 'eval-admin@test.local', '{"full_name":"評価 Admin"}'::jsonb),
  ('11000000-0000-4000-8000-000000000653', 'eval-author@test.local', '{"full_name":"評価 Author"}'::jsonb),
  ('11000000-0000-4000-8000-000000000654', 'eval-manager@test.local', '{"full_name":"評価 Manager"}'::jsonb),
  ('11000000-0000-4000-8000-000000000655', 'eval-planner@test.local', '{"full_name":"評価 Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000656', 'eval-viewer@test.local', '{"full_name":"評価 Viewer"}'::jsonb),
  ('11000000-0000-4000-8000-000000000657', 'eval-subject@test.local', '{"full_name":"評価 Subject"}'::jsonb),
  ('11000000-0000-4000-8000-000000000658', 'eval-other@test.local', '{"full_name":"評価 Other"}'::jsonb),
  ('11000000-0000-4000-8000-000000000659', 'eval-suspended@test.local', '{"full_name":"評価 Suspended"}'::jsonb),
  ('11000000-0000-4000-8000-000000000660', 'eval-left-manager@test.local', '{"full_name":"評価 Left Manager"}'::jsonb),
  ('11000000-0000-4000-8000-000000000661', 'eval-extra-manager@test.local', '{"full_name":"評価 Extra Manager"}'::jsonb);

update app.profiles set display_name = '評価 Author' where id = '11000000-0000-4000-8000-000000000653';

insert into app.organizations (id, name, slug, workspace_changed_by, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000651', 'Evaluation Tenant', 'evaluation-tenant-test',
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651'),
  ('21000000-0000-4000-8000-000000000652', 'Evaluation Other Tenant', 'evaluation-other-tenant-test',
   '11000000-0000-4000-8000-000000000658', '11000000-0000-4000-8000-000000000658', '11000000-0000-4000-8000-000000000658');

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by)
select '21000000-0000-4000-8000-000000000651', member.user_id::uuid, member.role, 'active',
       '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651'
from (values
  ('11000000-0000-4000-8000-000000000651', 'owner'),
  ('11000000-0000-4000-8000-000000000652', 'admin'),
  ('11000000-0000-4000-8000-000000000653', 'planner'),
  ('11000000-0000-4000-8000-000000000654', 'planner'),
  ('11000000-0000-4000-8000-000000000655', 'planner'),
  ('11000000-0000-4000-8000-000000000656', 'viewer'),
  ('11000000-0000-4000-8000-000000000657', 'planner'),
  ('11000000-0000-4000-8000-000000000660', 'planner'),
  ('11000000-0000-4000-8000-000000000661', 'planner')
) as member(user_id, role);

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000659', 'planner', 'suspended',
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651');

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000652', '11000000-0000-4000-8000-000000000658', 'owner', 'active',
   '11000000-0000-4000-8000-000000000658', '11000000-0000-4000-8000-000000000658');

insert into app.org_units (id, organization_id, name, parent_id, created_by, updated_by) values
  ('65000000-0000-4000-8000-000000000651', '21000000-0000-4000-8000-000000000651', 'Root', null,
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651');
insert into app.org_units (id, organization_id, name, parent_id, created_by, updated_by) values
  ('65000000-0000-4000-8000-000000000652', '21000000-0000-4000-8000-000000000651', 'Unit A', '65000000-0000-4000-8000-000000000651',
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651'),
  ('65000000-0000-4000-8000-000000000653', '21000000-0000-4000-8000-000000000651', 'Unit B', null,
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651'),
  ('65000000-0000-4000-8000-000000000654', '21000000-0000-4000-8000-000000000651', 'Unit C', null,
   '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651');

insert into app.people (id, organization_id, user_id, initials, name, role_title, department, location, created_by, updated_by)
select person.id::uuid, '21000000-0000-4000-8000-000000000651', person.user_id::uuid, person.initials, person.name, 'Engineer', 'Dept', 'Tokyo',
       '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651'
from (values
  ('61000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000657', 'ES', 'Eval Subject'),
  ('61000000-0000-4000-8000-000000000652', '11000000-0000-4000-8000-000000000653', 'EA', 'Eval Author'),
  ('61000000-0000-4000-8000-000000000653', '11000000-0000-4000-8000-000000000654', 'EM', 'Eval Manager'),
  ('61000000-0000-4000-8000-000000000654', '11000000-0000-4000-8000-000000000655', 'EP', 'Eval Planner'),
  ('61000000-0000-4000-8000-000000000655', '11000000-0000-4000-8000-000000000652', 'ED', 'Eval Admin'),
  ('61000000-0000-4000-8000-000000000656', '11000000-0000-4000-8000-000000000656', 'EV', 'Eval Viewer'),
  ('61000000-0000-4000-8000-000000000657', '11000000-0000-4000-8000-000000000660', 'EL', 'Eval Left Manager'),
  ('61000000-0000-4000-8000-000000000658', '11000000-0000-4000-8000-000000000661', 'EX', 'Eval Extra Manager')
) as person(id, user_id, initials, name);

update app.people set is_active = false where id = '61000000-0000-4000-8000-000000000657';

insert into app.person_org_units (organization_id, person_id, org_unit_id, is_primary, is_manager) values
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651', '65000000-0000-4000-8000-000000000652', true, false),
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000652', '65000000-0000-4000-8000-000000000652', true, false),
  -- manages Root, so Unit A below it
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000653', '65000000-0000-4000-8000-000000000651', true, true),
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000654', '65000000-0000-4000-8000-000000000653', true, false),
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000655', '65000000-0000-4000-8000-000000000653', true, false),
  -- a viewer who manages the subject's unit still reads nothing
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000656', '65000000-0000-4000-8000-000000000652', true, true),
  -- a manager of the subject's unit whose own people row is no longer active
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000657', '65000000-0000-4000-8000-000000000652', true, true),
  -- the subject also belongs to Unit C, whose manager is someone else
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651', '65000000-0000-4000-8000-000000000654', false, false),
  ('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000658', '65000000-0000-4000-8000-000000000654', true, true);

-- The admin is limited to its own unit (Unit B); the subject is in Unit A.
insert into app.role_permissions (organization_id, role, person_scope, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000651', 'admin', 'unit', '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651');

insert into app.projects (id, organization_id, code, name, status, tone, start_date, end_date, progress_percent, demand_headcount, created_by, updated_by) values
  ('62000000-0000-4000-8000-000000000651', '21000000-0000-4000-8000-000000000651', 'EVAL', 'Evaluation Project', '完了', 'blue',
   current_date - 90, current_date - 1, 100, 1, '11000000-0000-4000-8000-000000000651', '11000000-0000-4000-8000-000000000651');

create temporary table eval_runtime (label text primary key, value jsonb not null) on commit drop;
grant select, insert, update on table eval_runtime to authenticated;

select has_table('app', 'person_evaluations', 'the evaluations table exists');

select ok(
  not has_table_privilege('authenticated', 'app.person_evaluations', 'SELECT')
  and not has_table_privilege('service_role', 'app.person_evaluations', 'SELECT')
  and has_function_privilege('authenticated', 'public.list_person_evaluations(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_person_evaluation(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.withdraw_person_evaluation(uuid,uuid,bigint,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_person_evaluations(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.list_person_evaluations(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_person_evaluation(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.withdraw_person_evaluation(uuid,uuid,bigint,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.managed_person_ids(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.evaluation_actor_role(uuid,uuid)', 'EXECUTE'),
  'evaluations are reachable only through the three RPCs, and not from the service role'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000653';

insert into eval_runtime (label, value)
select 'shared', public.save_person_evaluation(
  '21000000-0000-4000-8000-000000000651',
  '94000000-0000-4000-8000-000000000651',
  jsonb_build_object(
    'personId', '61000000-0000-4000-8000-000000000651',
    'projectId', '62000000-0000-4000-8000-000000000651',
    'observedOn', current_date::text,
    'strengths', '  顧客との調整を先回りして進め、遅延を防いだ  ',
    'visibility', 'assigners'
  )
);

select ok(
  (select value ->> 'id' is not null and (value ->> 'replayed')::boolean = false from eval_runtime where label = 'shared'),
  'a planner writes an evaluation shared with the people who assign'
);

select is(
  public.save_person_evaluation(
    '21000000-0000-4000-8000-000000000651',
    '94000000-0000-4000-8000-000000000651',
    jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '別の本文')
  ) ->> 'replayed',
  'true',
  'the same request replays for its author'
);

insert into eval_runtime (label, value)
select 'restricted', public.save_person_evaluation(
  '21000000-0000-4000-8000-000000000651',
  '94000000-0000-4000-8000-000000000652',
  jsonb_build_object(
    'personId', '61000000-0000-4000-8000-000000000651',
    'observedOn', current_date::text,
    'concerns', '見積もりが甘く、二度手戻りした',
    'basis', '9月の移行判定で、テスト工数を半分で見積もっていた',
    'visibility', 'managers'
  )
);

select ok(
  (select value ->> 'id' is not null from eval_runtime where label = 'restricted'),
  'a planner writes an evaluation limited to managers'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'concerns', '理由の無い課題'))$$,
  '22023',
  'concerns need the reason and the scene they come from',
  'concerns need a basis'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'basis', '場面だけ'))$$,
  '22023',
  'an evaluation needs strengths or concerns',
  'an evaluation says something good or something to work on'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '良い', 'score', 5))$$,
  '22023',
  'p_evaluation takes only id, expectedVersion, personId, projectId, observedOn, strengths, concerns, basis, and visibility',
  'an unknown key is refused'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000652', 'observedOn', current_date::text, 'strengths', '自分は頑張った'))$$,
  '42501',
  'not authorized',
  'nobody evaluates themselves'
);

-- The subject, who is also a planner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000657';

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  'not authorized',
  'the subject cannot read evaluations about themselves'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000659';

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  'not authorized',
  'a suspended member reads nothing'
);

-- A viewer who manages the subject's unit.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000656';

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  'not authorized',
  'a viewer reads no evaluations, even of someone in a unit it manages'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '良い'))$$,
  '42501',
  'not authorized',
  'a viewer writes no evaluations'
);

-- A planner who is neither the author nor a manager of the subject.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000655';

select is(
  (select array_agg(item ->> 'visibility' order by item ->> 'visibility')
   from jsonb_array_elements(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items') as item),
  array['assigners'],
  'another planner reads only the evaluations shared with the people who assign'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', '94000000-0000-4000-8000-000000000651',
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '他人の request id'))$$,
  '42501',
  'not authorized',
  'another author cannot replay someone else''s request id'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from eval_runtime where label = 'shared'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '書き換え'))$$,
  '42501',
  'not authorized',
  'only the author changes an evaluation'
);

select throws_ok(
  $$select public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651',
      (select (value ->> 'id')::uuid from eval_runtime where label = 'shared'), 1, '気に入らない', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'a planner who did not write it cannot withdraw it'
);

select throws_ok(
  $$select public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651', '94000000-0000-4000-8000-0000000006ff', 1, '理由', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'an evaluation that does not exist is refused like one the caller may not touch'
);

-- The subject's manager (manages Root, the subject is in Unit A below it).
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000654';

select is(
  jsonb_array_length(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items'),
  2,
  'the subject''s manager reads the evaluations limited to managers as well'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000661';

select is(
  jsonb_array_length(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items'),
  2,
  'the manager of a unit the subject belongs to as a second membership is a manager too'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000660';

select is(
  jsonb_array_length(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items'),
  1,
  'a manager whose own people row is inactive is no longer a manager'
);

-- The owner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000651';

select ok(
  (
    select count(*) = 2
      and bool_or(item ->> 'strengths' = '顧客との調整を先回りして進め、遅延を防いだ')
      and bool_or(item ->> 'projectName' = 'Evaluation Project')
      and bool_and(item ->> 'authorName' = '評価 Author')
      and bool_and(not (item ->> 'mine')::boolean and not (item ->> 'canEdit')::boolean and (item ->> 'canWithdraw')::boolean)
    from jsonb_array_elements(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items') as item
  ),
  'the owner reads every evaluation, trimmed, with the project and the author, and may withdraw but not edit'
);

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-0000000006ff')$$,
  '42501',
  'not authorized',
  'a person who does not exist is refused like one out of scope'
);

select ok(
  position('先回りして進め' in public.get_workspace('21000000-0000-4000-8000-000000000651')::text) = 0
  and position('見積もりが甘く' in public.get_workspace('21000000-0000-4000-8000-000000000651')::text) = 0,
  'the workspace snapshot carries no evaluation text'
);

-- The admin limited to Unit B.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000652';

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  'not authorized',
  'an admin limited to another unit cannot read the subject'
);

select throws_ok(
  $$select public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651',
      (select (value ->> 'id')::uuid from eval_runtime where label = 'shared'), 1, '範囲外から', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'an admin limited to another unit cannot withdraw an evaluation of the subject'
);

select ok(
  (
    select count(*) >= 2
      and bool_and(not (item -> 'newData' ? 'strengths') and not (item -> 'newData' ? 'concerns') and not (item -> 'newData' ? 'basis'))
      and bool_and(item -> 'newData' ? 'person_id')
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000651', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_evaluations'
  ),
  'the audit shows an admin that an evaluation changed, without its text'
);

-- Another organization's owner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000658';

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  'not authorized',
  'another organization reads nothing'
);

-- Back to the author: edit with the version read, then with a stale one.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000653';

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', '94000000-0000-4000-8000-000000000651',
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000654', 'observedOn', current_date::text, 'strengths', '別の人'))$$,
  '22023',
  'p_request_id was already used for another evaluation',
  'a request id used for one person does not report a save for another'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from eval_runtime where label = 'shared'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000654', 'observedOn', current_date::text, 'strengths', '対象の差し替え'))$$,
  '42501',
  'not authorized',
  'an edit cannot move an evaluation to another person'
);

select is(
  public.save_person_evaluation(
    '21000000-0000-4000-8000-000000000651',
    gen_random_uuid(),
    jsonb_build_object(
      'id', (select value ->> 'id' from eval_runtime where label = 'shared'), 'expectedVersion', 1,
      'personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text,
      'strengths', '顧客との調整を先回りして進め、遅延を防いだ。後任への引き継ぎも丁寧だった', 'visibility', 'assigners'
    )
  ) ->> 'version',
  '2',
  'the author edits at the version read'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from eval_runtime where label = 'shared'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text, 'strengths', '古い版から'))$$,
  '40001',
  'evaluation was changed since it was read',
  'an edit from a stale version is refused'
);

-- The owner withdraws the restricted one.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000651';

select throws_ok(
  $$select public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651',
      (select (value ->> 'id')::uuid from eval_runtime where label = 'restricted'), 1, '   ', gen_random_uuid())$$,
  '22023',
  'a withdrawal reason must be between 1 and 500 characters',
  'a withdrawal needs a reason'
);

select lives_ok(
  $$select public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651',
      (select (value ->> 'id')::uuid from eval_runtime where label = 'restricted'), 1, '本人と面談し、事実関係に誤りがあったため', gen_random_uuid())$$,
  'the owner withdraws an evaluation with a reason'
);

select is(
  public.withdraw_person_evaluation('21000000-0000-4000-8000-000000000651',
    (select (value ->> 'id')::uuid from eval_runtime where label = 'restricted'), 2, '二度目', gen_random_uuid()) ->> 'replayed',
  'true',
  'withdrawing again replays'
);

select ok(
  (
    select item ->> 'concerns' = '見積もりが甘く、二度手戻りした'
      and item -> 'withdrawn' ->> 'reason' = '本人と面談し、事実関係に誤りがあったため'
      and not (item ->> 'canWithdraw')::boolean
    from jsonb_array_elements(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from eval_runtime where label = 'restricted')
  ),
  'the owner still reads the text of a withdrawn evaluation, with the reason'
);

select ok(
  (
    select count(*) >= 2 and bool_or(item -> 'newData' ? 'concerns')
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000651', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_evaluations'
  ),
  'the owner reads the evaluation text in the audit'
);

set local app.caller_kind = 'integration';

select ok(
  (
    select count(*) >= 2 and bool_and(not (item -> 'newData' ? 'concerns') and not (item -> 'newData' ? 'strengths'))
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000651', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_evaluations'
  ),
  'an integration caller never reads evaluation text in the audit, even as the owner'
);

set local app.caller_kind = 'user';

-- The manager sees that it was withdrawn and why, not what it said.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000654';

select ok(
  (
    select not (item ? 'concerns') and not (item ? 'basis') and not (item ? 'strengths')
      and item -> 'withdrawn' ->> 'reason' = '本人と面談し、事実関係に誤りがあったため'
    from jsonb_array_elements(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from eval_runtime where label = 'restricted')
  ),
  'a manager reads that an evaluation was withdrawn and why, but not its text'
);

-- The author keeps the text of their own withdrawn evaluation and cannot edit it.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000653';

select ok(
  (
    select item ->> 'basis' = '9月の移行判定で、テスト工数を半分で見積もっていた'
      and (item ->> 'mine')::boolean and not (item ->> 'canEdit')::boolean
    from jsonb_array_elements(public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from eval_runtime where label = 'restricted')
  ),
  'the author still reads their own withdrawn evaluation'
);

select throws_ok(
  $$select public.save_person_evaluation('21000000-0000-4000-8000-000000000651', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from eval_runtime where label = 'restricted'), 'expectedVersion', 2,
        'personId', '61000000-0000-4000-8000-000000000651', 'observedOn', current_date::text,
        'concerns', '書き直し', 'basis', '場面'))$$,
  '42501',
  'not authorized',
  'a withdrawn evaluation cannot be edited'
);

reset role;

select ok(
  (
    select count(*) = 2
      and bool_and(evaluation.created_by = '11000000-0000-4000-8000-000000000653')
      and bool_or(evaluation.withdrawn_by = '11000000-0000-4000-8000-000000000651')
    from app.person_evaluations as evaluation
    where evaluation.organization_id = '21000000-0000-4000-8000-000000000651'
  ),
  'two evaluations are stored, written by the author, one withdrawn by the owner'
);

select is(
  (select count(*)::integer from app.audit_events where entity_type = 'person_evaluations' and organization_id = '21000000-0000-4000-8000-000000000651'),
  4,
  'two inserts, one edit, and one withdrawal are audited'
);

set local role anon;

select throws_ok(
  $$select public.list_person_evaluations('21000000-0000-4000-8000-000000000651', '61000000-0000-4000-8000-000000000651')$$,
  '42501',
  null,
  'anon cannot call the evaluation RPCs'
);

reset role;

select * from finish();
rollback;
