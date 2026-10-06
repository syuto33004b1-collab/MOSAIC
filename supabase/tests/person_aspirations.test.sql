begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

-- What a person said they want and want to avoid, as heard (#610).
select plan(46);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000671', 'asp-owner@test.local', '{"full_name":"志向 Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000672', 'asp-admin@test.local', '{"full_name":"志向 Admin"}'::jsonb),
  ('11000000-0000-4000-8000-000000000673', 'asp-author@test.local', '{"full_name":"志向 Author"}'::jsonb),
  ('11000000-0000-4000-8000-000000000675', 'asp-planner@test.local', '{"full_name":"志向 Planner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000676', 'asp-viewer@test.local', '{"full_name":"志向 Viewer"}'::jsonb),
  ('11000000-0000-4000-8000-000000000677', 'asp-subject@test.local', '{"full_name":"志向 Subject"}'::jsonb),
  ('11000000-0000-4000-8000-000000000678', 'asp-other@test.local', '{"full_name":"志向 Other"}'::jsonb),
  ('11000000-0000-4000-8000-000000000679', 'asp-suspended@test.local', '{"full_name":"志向 Suspended"}'::jsonb);

update app.profiles set display_name = '志向 Author' where id = '11000000-0000-4000-8000-000000000673';

insert into app.organizations (id, name, slug, workspace_changed_by, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000671', 'Aspiration Tenant', 'aspiration-tenant-test',
   '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671'),
  ('21000000-0000-4000-8000-000000000672', 'Aspiration Other Tenant', 'aspiration-other-tenant-test',
   '11000000-0000-4000-8000-000000000678', '11000000-0000-4000-8000-000000000678', '11000000-0000-4000-8000-000000000678');

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by)
select '21000000-0000-4000-8000-000000000671', member.user_id::uuid, member.role, member.status,
       '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671'
from (values
  ('11000000-0000-4000-8000-000000000671', 'owner', 'active'),
  ('11000000-0000-4000-8000-000000000672', 'admin', 'active'),
  ('11000000-0000-4000-8000-000000000673', 'planner', 'active'),
  ('11000000-0000-4000-8000-000000000675', 'planner', 'active'),
  ('11000000-0000-4000-8000-000000000676', 'viewer', 'active'),
  ('11000000-0000-4000-8000-000000000677', 'planner', 'active'),
  ('11000000-0000-4000-8000-000000000679', 'planner', 'suspended')
) as member(user_id, role, status);

insert into app.organization_memberships (organization_id, user_id, role, status, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000672', '11000000-0000-4000-8000-000000000678', 'owner', 'active',
   '11000000-0000-4000-8000-000000000678', '11000000-0000-4000-8000-000000000678');

insert into app.org_units (id, organization_id, name, parent_id, created_by, updated_by) values
  ('65000000-0000-4000-8000-000000000671', '21000000-0000-4000-8000-000000000671', 'Unit A', null,
   '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671'),
  ('65000000-0000-4000-8000-000000000672', '21000000-0000-4000-8000-000000000671', 'Unit B', null,
   '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671');

insert into app.people (id, organization_id, user_id, initials, name, role_title, department, location, created_by, updated_by)
select person.id::uuid, '21000000-0000-4000-8000-000000000671', person.user_id::uuid, person.initials, person.name, 'Engineer', 'Dept', 'Tokyo',
       '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671'
from (values
  ('61000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000677', 'AS', 'Asp Subject'),
  ('61000000-0000-4000-8000-000000000672', '11000000-0000-4000-8000-000000000673', 'AA', 'Asp Author'),
  ('61000000-0000-4000-8000-000000000673', '11000000-0000-4000-8000-000000000675', 'AP', 'Asp Planner'),
  ('61000000-0000-4000-8000-000000000674', '11000000-0000-4000-8000-000000000672', 'AD', 'Asp Admin'),
  ('61000000-0000-4000-8000-000000000675', null, 'AN', 'Asp No Login')
) as person(id, user_id, initials, name);

insert into app.person_org_units (organization_id, person_id, org_unit_id, is_primary, is_manager) values
  ('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671', '65000000-0000-4000-8000-000000000671', true, false),
  ('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000674', '65000000-0000-4000-8000-000000000672', true, false);

-- The admin is limited to its own unit (Unit B); the subject is in Unit A.
insert into app.role_permissions (organization_id, role, person_scope, created_by, updated_by) values
  ('21000000-0000-4000-8000-000000000671', 'admin', 'unit', '11000000-0000-4000-8000-000000000671', '11000000-0000-4000-8000-000000000671');

create temporary table aspiration_runtime (label text primary key, value jsonb not null) on commit drop;
grant select, insert, update on table aspiration_runtime to authenticated;

select has_table('app', 'person_aspirations', 'the aspirations table exists');

select ok(
  not has_table_privilege('authenticated', 'app.person_aspirations', 'SELECT')
  and not has_table_privilege('service_role', 'app.person_aspirations', 'SELECT')
  and has_function_privilege('authenticated', 'public.list_person_aspirations(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.save_person_aspiration(uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.withdraw_person_aspiration(uuid,uuid,bigint,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_person_aspirations(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_person_aspiration(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.list_person_aspirations(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_person_aspiration(uuid,uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.withdraw_person_aspiration(uuid,uuid,bigint,text,uuid)', 'EXECUTE'),
  'aspirations are reachable only through the three RPCs, and not from the service role'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000673';

insert into aspiration_runtime (label, value)
select 'first', public.save_person_aspiration(
  '21000000-0000-4000-8000-000000000671',
  '95000000-0000-4000-8000-000000000671',
  jsonb_build_object(
    'personId', '61000000-0000-4000-8000-000000000671',
    'heardOn', current_date::text,
    'context', '  期初の1on1  ',
    'wishes', '  顧客と直接話す仕事を増やしたい  '
  )
);

select ok(
  (select value ->> 'id' is not null and (value ->> 'replayed')::boolean = false from aspiration_runtime where label = 'first'),
  'a planner writes down what the person said'
);

select is(
  public.save_person_aspiration(
    '21000000-0000-4000-8000-000000000671',
    '95000000-0000-4000-8000-000000000671',
    jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '別の本文')
  ) ->> 'replayed',
  'true',
  'the same request replays for its author'
);

insert into aspiration_runtime (label, value)
select 'second', public.save_person_aspiration(
  '21000000-0000-4000-8000-000000000671',
  '95000000-0000-4000-8000-000000000672',
  jsonb_build_object(
    'personId', '61000000-0000-4000-8000-000000000671',
    'heardOn', (current_date - 30)::text,
    'avoids', '夜間の障害対応が続く体制は避けたい'
  )
);

select ok(
  (select value ->> 'id' is not null from aspiration_runtime where label = 'second'),
  'what the person wants to avoid is enough on its own'
);

select lives_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000675', 'heardOn', current_date::text, 'wishes', '設計から関わりたい'))$$,
  'a person without a login can have their words written down'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'context', '場面だけ', 'wishes', '   '))$$,
  '22023',
  'an aspiration needs wishes or avoids',
  'a record says what the person wants or wants to avoid'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '良い', 'type', 'INTJ'))$$,
  '22023',
  'p_aspiration takes only id, expectedVersion, personId, heardOn, context, wishes, and avoids',
  'an unknown key is refused'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', 'last week', 'wishes', '良い'))$$,
  '22023',
  'heardOn must be a date',
  'the day it was heard is a date'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', repeat('あ', 1001)))$$,
  '22023',
  'each aspiration text is at most 1000 characters',
  'a text longer than 1000 characters is refused'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'context', repeat('あ', 201), 'wishes', '良い'))$$,
  '22023',
  'context is at most 200 characters',
  'a context longer than 200 characters is refused'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000672', 'heardOn', current_date::text, 'wishes', '自分の希望'))$$,
  '42501',
  'not authorized',
  'nobody writes this record about themselves'
);

-- The subject, who is also a planner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000677';

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  'not authorized',
  'the subject cannot read what was written about them'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000679';

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  'not authorized',
  'a suspended member reads nothing'
);

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000676';

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  'not authorized',
  'a viewer reads no aspirations'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '良い'))$$,
  '42501',
  'not authorized',
  'a viewer writes no aspirations'
);

-- A planner who did not write them.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000675';

select ok(
  (
    select count(*) = 2
      and bool_and(not (item ->> 'mine')::boolean and not (item ->> 'canEdit')::boolean and not (item ->> 'canWithdraw')::boolean)
      and bool_or(item ->> 'avoids' = '夜間の障害対応が続く体制は避けたい')
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items') as item
  ),
  'another planner reads every record, and may neither edit nor withdraw them'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', '95000000-0000-4000-8000-000000000671',
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '他人の request id'))$$,
  '42501',
  'not authorized',
  'another author cannot replay someone else''s request id'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from aspiration_runtime where label = 'first'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '書き換え'))$$,
  '42501',
  'not authorized',
  'only the author changes a record'
);

select throws_ok(
  $$select public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671',
      (select (value ->> 'id')::uuid from aspiration_runtime where label = 'first'), 1, '気に入らない', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'a planner who did not write it cannot withdraw it'
);

select throws_ok(
  $$select public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671', '95000000-0000-4000-8000-0000000006ff', 1, '理由', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'a record that does not exist is refused like one the caller may not touch'
);

-- The owner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000671';

select ok(
  (
    select count(*) = 2
      and bool_or(item ->> 'wishes' = '顧客と直接話す仕事を増やしたい' and item ->> 'context' = '期初の1on1')
      and bool_and(item ->> 'authorName' = '志向 Author')
      and bool_and(not (item ->> 'canEdit')::boolean and (item ->> 'canWithdraw')::boolean)
      and (array_agg(item ->> 'id' order by position))[1] = (select value ->> 'id' from aspiration_runtime where label = 'first')
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items')
      with ordinality as entry(item, position)
  ),
  'the owner reads every record, trimmed, newest first, with who heard it, and may withdraw but not edit'
);

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-0000000006ff')$$,
  '42501',
  'not authorized',
  'a person who does not exist is refused like one out of scope'
);

select ok(
  position('顧客と直接話す' in public.get_workspace('21000000-0000-4000-8000-000000000671')::text) = 0
  and position('夜間の障害対応' in public.get_workspace('21000000-0000-4000-8000-000000000671')::text) = 0
  and position('期初の1on1' in public.get_workspace('21000000-0000-4000-8000-000000000671')::text) = 0,
  'the workspace snapshot carries no aspiration text'
);

-- The admin limited to Unit B.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000672';

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  'not authorized',
  'an admin limited to another unit cannot read the subject'
);

select throws_ok(
  $$select public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671',
      (select (value ->> 'id')::uuid from aspiration_runtime where label = 'first'), 1, '範囲外から', gen_random_uuid())$$,
  '42501',
  'not authorized',
  'an admin limited to another unit cannot withdraw a record about the subject'
);

select ok(
  (
    select count(*) >= 3
      and bool_and(
        not (item -> 'newData' ? 'wishes') and not (item -> 'newData' ? 'avoids') and not (item -> 'newData' ? 'context')
      )
      and bool_and(item -> 'newData' ? 'person_id' and item -> 'newData' ? 'heard_on')
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000671', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_aspirations'
  ),
  'the audit shows an admin that a record changed and when it was heard, without its text'
);

-- Another organization's owner.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000678';

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  'not authorized',
  'another organization reads nothing'
);

-- Back to the author: edit with the version read, then with a stale one.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000673';

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', '95000000-0000-4000-8000-000000000671',
      jsonb_build_object('personId', '61000000-0000-4000-8000-000000000673', 'heardOn', current_date::text, 'wishes', '別の人'))$$,
  '22023',
  'p_request_id was already used for another aspiration',
  'a request id used for one person does not report a save for another'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from aspiration_runtime where label = 'first'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000673', 'heardOn', current_date::text, 'wishes', '対象の差し替え'))$$,
  '42501',
  'not authorized',
  'an edit cannot move a record to another person'
);

select ok(
  (
    select (result ->> 'version') = '2'
    from (
      select public.save_person_aspiration(
        '21000000-0000-4000-8000-000000000671',
        gen_random_uuid(),
        jsonb_build_object(
          'id', (select value ->> 'id' from aspiration_runtime where label = 'first'), 'expectedVersion', 1,
          'personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text,
          'wishes', '顧客と直接話す仕事を増やしたい。提案の段階から入りたい'
        )
      ) as result
    ) as saved
  ),
  'the author edits at the version read'
);

select ok(
  (
    select item ->> 'context' is null and item ->> 'wishes' = '顧客と直接話す仕事を増やしたい。提案の段階から入りたい'
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from aspiration_runtime where label = 'first')
  ),
  'an edit replaces the whole record, so a context left out is cleared'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from aspiration_runtime where label = 'first'), 'expectedVersion', 1,
        'personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'wishes', '古い版から'))$$,
  '40001',
  'aspiration was changed since it was read',
  'an edit from a stale version is refused'
);

-- The owner withdraws the second one.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000671';

select throws_ok(
  $$select public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671',
      (select (value ->> 'id')::uuid from aspiration_runtime where label = 'second'), 1, '   ', gen_random_uuid())$$,
  '22023',
  'a withdrawal reason must be between 1 and 500 characters',
  'a withdrawal needs a reason'
);

select lives_ok(
  $$select public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671',
      (select (value ->> 'id')::uuid from aspiration_runtime where label = 'second'), 1, '本人に確かめたところ、聞き違いだった', gen_random_uuid())$$,
  'the owner withdraws a record with a reason'
);

select is(
  public.withdraw_person_aspiration('21000000-0000-4000-8000-000000000671',
    (select (value ->> 'id')::uuid from aspiration_runtime where label = 'second'), 2, '二度目', gen_random_uuid()) ->> 'replayed',
  'true',
  'withdrawing again replays'
);

select ok(
  (
    select item ->> 'avoids' = '夜間の障害対応が続く体制は避けたい'
      and item -> 'withdrawn' ->> 'reason' = '本人に確かめたところ、聞き違いだった'
      and not (item ->> 'canWithdraw')::boolean
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from aspiration_runtime where label = 'second')
  ),
  'the owner still reads the text of a withdrawn record, with the reason'
);

select ok(
  (
    select count(*) >= 3 and bool_or(item -> 'newData' ? 'wishes') and bool_or(item -> 'newData' ? 'withdrawn_reason')
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000671', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_aspirations'
  ),
  'the owner reads the aspiration text in the audit'
);

set local app.caller_kind = 'integration';

select ok(
  (
    select count(*) >= 3
      and bool_and(not (item -> 'newData' ? 'wishes') and not (item -> 'newData' ? 'avoids') and not (item -> 'newData' ? 'withdrawn_reason'))
    from jsonb_array_elements(public.list_audit_events('21000000-0000-4000-8000-000000000671', 200, null) -> 'items') as item
    where item ->> 'entityType' = 'person_aspirations'
  ),
  'an integration caller never reads aspiration text in the audit, even as the owner'
);

set local app.caller_kind = 'user';

-- Another planner sees that it was withdrawn and why, not what it said.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000675';

select ok(
  (
    select not (item ? 'avoids') and not (item ? 'wishes') and not (item ? 'context')
      and item -> 'withdrawn' ->> 'reason' = '本人に確かめたところ、聞き違いだった'
      and item ->> 'heardOn' = (current_date - 30)::text
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from aspiration_runtime where label = 'second')
  ),
  'another planner reads that a record was withdrawn, when it was heard, and why, but not its text'
);

-- The author keeps the text of their own withdrawn record and cannot edit it.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000673';

select ok(
  (
    select item ->> 'avoids' = '夜間の障害対応が続く体制は避けたい'
      and (item ->> 'mine')::boolean and not (item ->> 'canEdit')::boolean
    from jsonb_array_elements(public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671') -> 'items') as item
    where item ->> 'id' = (select value ->> 'id' from aspiration_runtime where label = 'second')
  ),
  'the author still reads their own withdrawn record'
);

select throws_ok(
  $$select public.save_person_aspiration('21000000-0000-4000-8000-000000000671', gen_random_uuid(),
      jsonb_build_object(
        'id', (select value ->> 'id' from aspiration_runtime where label = 'second'), 'expectedVersion', 2,
        'personId', '61000000-0000-4000-8000-000000000671', 'heardOn', current_date::text, 'avoids', '書き直し'))$$,
  '42501',
  'not authorized',
  'a withdrawn record cannot be edited'
);

reset role;

select ok(
  (
    select count(*) = 2
      and bool_and(aspiration.created_by = '11000000-0000-4000-8000-000000000673')
      and bool_or(aspiration.withdrawn_by = '11000000-0000-4000-8000-000000000671')
    from app.person_aspirations as aspiration
    where aspiration.organization_id = '21000000-0000-4000-8000-000000000671'
      and aspiration.person_id = '61000000-0000-4000-8000-000000000671'
  ),
  'two records about the subject are stored, written by the author, one withdrawn by the owner'
);

select is(
  (select count(*)::integer from app.audit_events where entity_type = 'person_aspirations' and organization_id = '21000000-0000-4000-8000-000000000671'),
  5,
  'three inserts, one edit, and one withdrawal are audited'
);

select throws_ok(
  $$insert into app.person_aspirations (organization_id, request_id, person_id, heard_on)
    values ('21000000-0000-4000-8000-000000000671', gen_random_uuid(), '61000000-0000-4000-8000-000000000671', current_date)$$,
  '23514',
  null,
  'the table itself refuses a record that says nothing'
);

set local role anon;

select throws_ok(
  $$select public.list_person_aspirations('21000000-0000-4000-8000-000000000671', '61000000-0000-4000-8000-000000000671')$$,
  '42501',
  null,
  'anon cannot call the aspiration RPCs'
);

reset role;

select * from finish();
rollback;
