begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000121', 'write-owner@test.local', '{"full_name":"Write Owner"}'::jsonb),
  ('11000000-0000-4000-8000-000000000122', 'write-planner@test.local', '{"full_name":"Write Planner"}'::jsonb);

insert into app.organizations (
  id, name, slug, workspace_changed_by, created_by, updated_by
) values (
  '21000000-0000-4000-8000-000000000121',
  'MCP Write Tenant',
  'mcp-write-tenant-test',
  '11000000-0000-4000-8000-000000000121',
  '11000000-0000-4000-8000-000000000121',
  '11000000-0000-4000-8000-000000000121'
);

insert into app.organization_memberships (
  organization_id, user_id, role, status, created_by, updated_by
) values
  ('21000000-0000-4000-8000-000000000121', '11000000-0000-4000-8000-000000000121', 'owner', 'active',
   '11000000-0000-4000-8000-000000000121', '11000000-0000-4000-8000-000000000121'),
  ('21000000-0000-4000-8000-000000000121', '11000000-0000-4000-8000-000000000122', 'planner', 'active',
   '11000000-0000-4000-8000-000000000121', '11000000-0000-4000-8000-000000000121');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000121';

select lives_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000121',
      'acme_ops',
      'ACME運用',
      'https://mcp.example.com/mcp',
      array['search_ticket', 'create_ticket']::text[],
      array['create_ticket']::text[],
      '91000000-0000-4000-8000-000000000121'
    )$$,
  'a write tool inside the approved set may be declared'
);

select throws_ok(
  $$select public.create_mcp_server(
      '21000000-0000-4000-8000-000000000121',
      'bad_write',
      '範囲外',
      'https://mcp.example.com/mcp',
      array['search_ticket']::text[],
      array['delete_everything']::text[],
      '91000000-0000-4000-8000-000000000122'
    )$$,
  '22023',
  'write tools must be part of the approved tools',
  'a write tool outside the approved set is refused'
);

select is(
  (
    select entry.server -> 'writeTools'
    from jsonb_array_elements(public.list_mcp_tools('21000000-0000-4000-8000-000000000121') -> 'servers') as entry(server)
    where entry.server ->> 'serverKey' = 'acme_ops'
  ),
  '["create_ticket"]'::jsonb,
  'list_mcp_tools reports which approved tools write'
);

-- The read path must not be able to run a write tool.
select throws_ok(
  $$select public.begin_mcp_call('21000000-0000-4000-8000-000000000121', 'acme_ops', 'create_ticket')$$,
  '42501',
  'this tool writes and needs an explicit confirmation',
  'the read path refuses a write tool'
);

select lives_ok(
  $$select public.begin_mcp_call('21000000-0000-4000-8000-000000000121', 'acme_ops', 'search_ticket')$$,
  'the read path still runs a read tool'
);

-- Proposing must not hand out the address.
select ok(
  not (public.propose_mcp_call('21000000-0000-4000-8000-000000000121', 'acme_ops', 'create_ticket') ? 'url'),
  'propose_mcp_call withholds the address until the write is confirmed'
);

select throws_ok(
  $$select public.propose_mcp_call('21000000-0000-4000-8000-000000000121', 'acme_ops', 'search_ticket')$$,
  '42501',
  'this tool is not approved for writing on the mcp server',
  'a read tool cannot be proposed as a write'
);

reset role;

-- Confirm the newest pending write, then prove the confirmation is single use.
-- Stash the id in a GUC: a temporary table is not readable by the authenticated role.
select set_config(
  'test.pending_call_id',
  (
    select call_log.id::text
    from app.mcp_call_logs as call_log
    where call_log.organization_id = '21000000-0000-4000-8000-000000000121'
      and call_log.is_write
      and call_log.status = 'pending'
    order by call_log.started_at desc
    limit 1
  ),
  true
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000121';

select is(
  (select public.resume_mcp_call('21000000-0000-4000-8000-000000000121', current_setting('test.pending_call_id')::uuid) ->> 'url'),
  'https://mcp.example.com/mcp',
  'resume_mcp_call hands out the approved address for a confirmed write'
);

select is(
  (select public.complete_mcp_call(
      '21000000-0000-4000-8000-000000000121',
      current_setting('test.pending_call_id')::uuid,
      true, null, 10, 20, 30
    ) ->> 'recorded'),
  'true',
  'the executed write closes its audit row'
);

select throws_ok(
  $$select public.resume_mcp_call('21000000-0000-4000-8000-000000000121', current_setting('test.pending_call_id')::uuid)$$,
  'P0002',
  'no pending external write for this confirmation',
  'a replayed confirmation is refused'
);

reset role;

select is(
  (
    select call_log.is_write
    from app.mcp_call_logs as call_log
    where call_log.id = current_setting('test.pending_call_id')::uuid
  ),
  true,
  'the audit row distinguishes a write from a read'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000122';

select throws_ok(
  $$select public.resume_mcp_call(
      '21000000-0000-4000-8000-000000000121',
      current_setting('test.pending_call_id')::uuid
    )$$,
  'P0002',
  'no pending external write for this confirmation',
  'another member cannot confirm someone else''s write'
);

select * from finish();
rollback;
