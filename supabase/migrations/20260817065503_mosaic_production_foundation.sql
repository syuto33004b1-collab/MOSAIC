begin;

-- MOSAIC production foundation
--
-- Security model:
--   * Business data lives in the non-Data-API `app` schema.
--   * The browser can call only the explicitly granted RPCs in `public`.
--   * Every RPC is SECURITY DEFINER, has an empty search_path, validates
--     auth.uid(), and performs its own organization-role check.
--   * `app.organizations` is the only table granted to `authenticated`, and
--     only for RLS-protected Realtime revision notifications.

create schema if not exists extensions;
create schema if not exists app;
create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

revoke all on schema app from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;
grant usage on schema private to authenticated, service_role;

create table app.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  avatar_url text,
  locale text not null default 'ja-JP' check (char_length(locale) between 2 and 20),
  time_zone text not null default 'Asia/Tokyo' check (char_length(time_zone) between 1 and 80),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'
  ),
  workspace_revision bigint not null default 0 check (workspace_revision >= 0),
  access_revision bigint not null default 0 check (access_revision >= 0),
  workspace_changed_at timestamptz not null default now(),
  workspace_changed_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table app.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  -- Auth identities with membership history must be offboarded through the
  -- serialized membership RPC. Physical Auth deletion is deliberately blocked
  -- until a future explicit retention/cleanup workflow removes the membership.
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'planner', 'viewer')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  joined_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create table app.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  employee_code text check (employee_code is null or char_length(btrim(employee_code)) between 1 and 40),
  initials text not null check (char_length(btrim(initials)) between 1 and 8),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role_title text not null check (char_length(btrim(role_title)) between 1 and 120),
  department text not null check (char_length(btrim(department)) between 1 and 120),
  avatar_tone text not null default 'lavender' check (
    avatar_tone in ('lavender', 'peach', 'sky', 'mint', 'sand', 'rose')
  ),
  location text not null check (char_length(btrim(location)) between 1 and 120),
  capacity_percent numeric(5,2) not null default 100 check (
    capacity_percent >= 0 and capacity_percent <= 100
  ),
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, id)
);

create unique index people_organization_user_uidx
  on app.people (organization_id, user_id)
  where user_id is not null;

create unique index people_organization_employee_code_uidx
  on app.people (organization_id, lower(employee_code))
  where employee_code is not null;

create table app.skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  normalized_name text generated always as (lower(btrim(name))) stored,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (organization_id, normalized_name),
  unique (organization_id, id)
);

create table app.person_skills (
  organization_id uuid not null,
  person_id uuid not null,
  skill_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, person_id, skill_id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id)
    references app.skills (organization_id, id) on delete cascade
);

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  code text not null check (
    char_length(btrim(code)) between 1 and 20
    and code = upper(code)
  ),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  summary text not null default '' check (char_length(summary) <= 2000),
  status text not null check (
    status in ('進行中', '要注意', '準備中', '完了間近', '完了', 'アーカイブ')
  ),
  tone text not null default 'blue' check (tone in ('blue', 'mint', 'orange', 'plum', 'sky')),
  owner_person_id uuid,
  start_date date not null,
  end_date date not null,
  next_milestone text not null default '' check (char_length(next_milestone) <= 240),
  next_milestone_date date,
  progress_percent numeric(5,2) not null default 0 check (
    progress_percent >= 0 and progress_percent <= 100
  ),
  demand_headcount integer not null default 0 check (demand_headcount between 0 and 10000),
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (end_date >= start_date),
  unique (organization_id, id),
  foreign key (organization_id, owner_person_id)
    references app.people (organization_id, id) on delete restrict
);

create unique index projects_active_code_uidx
  on app.projects (organization_id, code)
  where archived_at is null;

create table app.staffing_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  project_id uuid not null,
  role_title text not null check (char_length(btrim(role_title)) between 1 and 120),
  start_date date not null,
  end_date date not null,
  allocation_percent numeric(5,2) not null check (
    allocation_percent > 0 and allocation_percent <= 100
  ),
  status text not null default 'open' check (
    status in ('open', 'planned', 'filled', 'cancelled')
  ),
  draft_person_id uuid,
  period daterange generated always as (daterange(start_date, end_date, '[]')) stored,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (end_date >= start_date),
  unique (organization_id, id),
  unique (organization_id, id, project_id),
  foreign key (organization_id, project_id)
    references app.projects (organization_id, id) on delete restrict,
  foreign key (organization_id, draft_person_id)
    references app.people (organization_id, id) on delete restrict
);

create table app.staffing_need_skills (
  organization_id uuid not null,
  staffing_need_id uuid not null,
  skill_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, staffing_need_id, skill_id),
  foreign key (organization_id, staffing_need_id)
    references app.staffing_needs (organization_id, id) on delete cascade,
  foreign key (organization_id, skill_id)
    references app.skills (organization_id, id) on delete cascade
);

create table app.assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  person_id uuid not null,
  project_id uuid not null,
  staffing_need_id uuid,
  start_date date not null,
  end_date date not null,
  allocation_percent numeric(5,2) not null check (
    allocation_percent > 0 and allocation_percent <= 100
  ),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  label text check (label is null or char_length(label) <= 240),
  client_request_id uuid,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  period daterange generated always as (daterange(start_date, end_date, '[]')) stored,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (end_date >= start_date),
  unique (organization_id, id),
  foreign key (organization_id, person_id)
    references app.people (organization_id, id) on delete restrict,
  foreign key (organization_id, project_id)
    references app.projects (organization_id, id) on delete restrict,
  foreign key (organization_id, staffing_need_id, project_id)
    references app.staffing_needs (organization_id, id, project_id) on delete restrict
);

create unique index assignments_client_request_uidx
  on app.assignments (organization_id, client_request_id)
  where client_request_id is not null;

create table app.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  email text not null check (
    char_length(btrim(email)) between 3 and 320
    and position('@' in email) > 1
  ),
  normalized_email text generated always as (lower(btrim(email))) stored,
  role text not null check (role in ('admin', 'planner', 'viewer')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  check (expires_at > created_at),
  check (not (accepted_at is not null and revoked_at is not null)),
  unique (organization_id, id)
);

create unique index organization_invitations_pending_uidx
  on app.organization_invitations (organization_id, normalized_email)
  where accepted_at is null and revoked_at is null;

create table app.workspace_commits (
  organization_id uuid not null references app.organizations (id) on delete restrict,
  request_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  new_revision bigint not null check (new_revision > expected_revision),
  client_payload_hash text not null check (client_payload_hash ~ '^[0-9a-f]{64}$'),
  server_payload_digest text not null check (server_payload_digest ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid references auth.users (id) on delete set null,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  saved_at timestamptz not null default now(),
  primary key (organization_id, request_id),
  unique (organization_id, new_revision)
);

-- Reserves an organization-creation request before any tenant rows are
-- written. A concurrent retry waits on this primary key and then replays the
-- completed organization instead of creating a duplicate tenant.
create table app.organization_creation_requests (
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  requested_name text not null check (char_length(btrim(requested_name)) between 1 and 120),
  organization_id uuid unique references app.organizations (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, request_id),
  check ((organization_id is null) = (completed_at is null))
);

create table app.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app.organizations (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid,
  entity_key jsonb not null default '{}'::jsonb check (jsonb_typeof(entity_key) = 'object'),
  request_id uuid,
  workspace_revision bigint not null check (workspace_revision >= 0),
  old_data jsonb,
  new_data jsonb,
  check (entity_id is not null or entity_key <> '{}'::jsonb),
  check (old_data is not null or new_data is not null)
);

-- Foreign-key, tenant lookup, planning-window, and audit indexes.
create index organization_memberships_rls_idx
  on app.organization_memberships (user_id, organization_id) include (role)
  where status = 'active';
create index organization_memberships_org_role_idx
  on app.organization_memberships (organization_id, role, user_id)
  where status = 'active';
create index people_directory_idx
  on app.people (organization_id, is_active, name, id);
create index people_user_idx
  on app.people (user_id) where user_id is not null;
create index person_skills_person_idx
  on app.person_skills (organization_id, person_id);
create index person_skills_skill_idx
  on app.person_skills (organization_id, skill_id);
create index projects_status_dates_idx
  on app.projects (organization_id, status, start_date, end_date, id)
  where archived_at is null;
create index projects_owner_idx
  on app.projects (organization_id, owner_person_id)
  where owner_person_id is not null and archived_at is null;
create index staffing_needs_open_idx
  on app.staffing_needs (organization_id, status, start_date, id)
  where status in ('open', 'planned');
create index staffing_needs_project_idx
  on app.staffing_needs (organization_id, project_id, start_date, end_date);
create index staffing_needs_period_gist
  on app.staffing_needs using gist (organization_id, project_id, period)
  where status in ('open', 'planned');
create index staffing_need_skills_need_idx
  on app.staffing_need_skills (organization_id, staffing_need_id);
create index staffing_need_skills_skill_idx
  on app.staffing_need_skills (organization_id, skill_id);
create index assignments_person_dates_idx
  on app.assignments (organization_id, person_id, start_date, end_date, id)
  where status <> 'cancelled';
create index assignments_project_dates_idx
  on app.assignments (organization_id, project_id, start_date, end_date, id)
  where status <> 'cancelled';
create index assignments_person_period_gist
  on app.assignments using gist (organization_id, person_id, period)
  where status <> 'cancelled';
create index assignments_need_idx
  on app.assignments (organization_id, staffing_need_id)
  where staffing_need_id is not null and status <> 'cancelled';
create index invitations_recipient_idx
  on app.organization_invitations (normalized_email, expires_at)
  where accepted_at is null and revoked_at is null;
create index workspace_commits_actor_idx
  on app.workspace_commits (organization_id, actor_user_id, saved_at desc);
create index audit_events_org_cursor_idx
  on app.audit_events (organization_id, id desc);
create index audit_events_entity_idx
  on app.audit_events (organization_id, entity_type, entity_id, id desc);
create index audit_events_request_idx
  on app.audit_events (organization_id, request_id)
  where request_id is not null;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from app.organization_memberships as membership
      join app.organizations as organization
        on organization.id = membership.organization_id
       and organization.archived_at is null
      where membership.organization_id = p_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role = any (p_roles)
    );
$function$;

create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.has_org_role(
    p_organization_id,
    array['owner', 'admin', 'planner', 'viewer']::text[]
  );
$function$;

create or replace function private.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select lower(auth_user.email)
  from auth.users as auth_user
  where auth_user.id = (select auth.uid());
$function$;

revoke all on function private.has_org_role(uuid, text[]) from public, anon, authenticated;
revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.current_email() from public, anon, authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.current_email() to authenticated, service_role;

-- RLS remains enabled as defense in depth even though direct Data API DML is revoked.
alter table app.profiles enable row level security;
alter table app.profiles force row level security;
alter table app.organizations enable row level security;
alter table app.organizations force row level security;
alter table app.organization_memberships enable row level security;
alter table app.organization_memberships force row level security;
alter table app.people enable row level security;
alter table app.people force row level security;
alter table app.skills enable row level security;
alter table app.skills force row level security;
alter table app.person_skills enable row level security;
alter table app.person_skills force row level security;
alter table app.projects enable row level security;
alter table app.projects force row level security;
alter table app.staffing_needs enable row level security;
alter table app.staffing_needs force row level security;
alter table app.staffing_need_skills enable row level security;
alter table app.staffing_need_skills force row level security;
alter table app.assignments enable row level security;
alter table app.assignments force row level security;
alter table app.organization_invitations enable row level security;
alter table app.organization_invitations force row level security;
alter table app.workspace_commits enable row level security;
alter table app.workspace_commits force row level security;
alter table app.organization_creation_requests enable row level security;
alter table app.organization_creation_requests force row level security;
alter table app.audit_events enable row level security;
alter table app.audit_events force row level security;

create policy profiles_select_self on app.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy organizations_select_member on app.organizations
  for select to authenticated
  using ((select private.is_org_member(id)));

create policy memberships_select_self_or_admin on app.organization_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_org_role(organization_id, array['owner', 'admin']::text[]))
  );

create policy people_select_member on app.people
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy skills_select_member on app.skills
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy person_skills_select_member on app.person_skills
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy projects_select_member on app.projects
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy staffing_needs_select_member on app.staffing_needs
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy staffing_need_skills_select_member on app.staffing_need_skills
  for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy assignments_select_member on app.assignments
  for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy invitations_select_recipient_or_admin on app.organization_invitations
  for select to authenticated
  using (
    normalized_email = (select private.current_email())
    or (select private.has_org_role(organization_id, array['owner', 'admin']::text[]))
  );

create policy workspace_commits_select_admin on app.workspace_commits
  for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin']::text[])));

create policy audit_events_select_admin on app.audit_events
  for select to authenticated
  using ((select private.has_org_role(organization_id, array['owner', 'admin']::text[])));

create or replace function private.touch_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

create or replace function private.touch_versioned_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    new.created_by := coalesce(new.created_by, v_user_id);
    new.updated_by := coalesce(new.updated_by, v_user_id);
  else
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(v_user_id, old.updated_by);
  end if;
  return new;
end;
$function$;

create or replace function private.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_removing_owner boolean := false;
begin
  if old.role = 'owner' and old.status = 'active' then
    if tg_op = 'DELETE' then
      v_removing_owner := true;
    else
      v_removing_owner := new.role <> 'owner' or new.status <> 'active';
    end if;
    if v_removing_owner then
      if not exists (
       select 1
       from app.organization_memberships as other_owner
       where other_owner.organization_id = old.organization_id
         and other_owner.id <> old.id
         and other_owner.role = 'owner'
         and other_owner.status = 'active'
      ) then
        raise exception using
          errcode = '23514',
          message = 'an organization must retain at least one active owner';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_organization_id uuid;
  v_entity_id uuid;
  v_entity_key jsonb;
  v_revision bigint;
  v_request_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'organizations' then
    v_organization_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  else
    v_organization_id := coalesce(
      (v_new ->> 'organization_id')::uuid,
      (v_old ->> 'organization_id')::uuid
    );
  end if;

  if tg_table_name = 'person_skills' then
    v_entity_id := coalesce((v_new ->> 'person_id')::uuid, (v_old ->> 'person_id')::uuid);
    v_entity_key := jsonb_build_object(
      'personId', coalesce(v_new ->> 'person_id', v_old ->> 'person_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  elsif tg_table_name = 'staffing_need_skills' then
    v_entity_id := coalesce((v_new ->> 'staffing_need_id')::uuid, (v_old ->> 'staffing_need_id')::uuid);
    v_entity_key := jsonb_build_object(
      'staffingNeedId', coalesce(v_new ->> 'staffing_need_id', v_old ->> 'staffing_need_id'),
      'skillId', coalesce(v_new ->> 'skill_id', v_old ->> 'skill_id')
    );
  else
    v_entity_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
    v_entity_key := jsonb_build_object('id', v_entity_id);
  end if;
  v_request_id := nullif(current_setting('app.request_id', true), '')::uuid;

  select organization.workspace_revision
  into v_revision
  from app.organizations as organization
  where organization.id = v_organization_id;

  insert into app.audit_events (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    entity_key,
    request_id,
    workspace_revision,
    old_data,
    new_data
  ) values (
    v_organization_id,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_entity_key,
    v_request_id,
    coalesce(v_revision, 0),
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.touch_profile() from public, anon, authenticated;
revoke all on function private.touch_versioned_row() from public, anon, authenticated;
revoke all on function private.prevent_last_owner_removal() from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;

create trigger profiles_touch
before update on app.profiles
for each row execute function private.touch_profile();

create trigger organizations_touch
before insert or update on app.organizations
for each row execute function private.touch_versioned_row();
create trigger memberships_touch
before insert or update on app.organization_memberships
for each row execute function private.touch_versioned_row();
create trigger people_touch
before insert or update on app.people
for each row execute function private.touch_versioned_row();
create trigger skills_touch
before insert or update on app.skills
for each row execute function private.touch_versioned_row();
create trigger projects_touch
before insert or update on app.projects
for each row execute function private.touch_versioned_row();
create trigger staffing_needs_touch
before insert or update on app.staffing_needs
for each row execute function private.touch_versioned_row();
create trigger assignments_touch
before insert or update on app.assignments
for each row execute function private.touch_versioned_row();
create trigger invitations_touch
before insert or update on app.organization_invitations
for each row execute function private.touch_versioned_row();

create trigger memberships_keep_owner
before update or delete on app.organization_memberships
for each row execute function private.prevent_last_owner_removal();

create trigger organizations_audit
after insert or update or delete on app.organizations
for each row execute function private.audit_row_change();
create trigger memberships_audit
after insert or update or delete on app.organization_memberships
for each row execute function private.audit_row_change();
create trigger people_audit
after insert or update or delete on app.people
for each row execute function private.audit_row_change();
create trigger projects_audit
after insert or update or delete on app.projects
for each row execute function private.audit_row_change();
create trigger staffing_needs_audit
after insert or update or delete on app.staffing_needs
for each row execute function private.audit_row_change();
create trigger assignments_audit
after insert or update or delete on app.assignments
for each row execute function private.audit_row_change();
create trigger invitations_audit
after insert or update or delete on app.organization_invitations
for each row execute function private.audit_row_change();
create trigger skills_audit
after insert or update or delete on app.skills
for each row execute function private.audit_row_change();
create trigger person_skills_audit
after insert or update or delete on app.person_skills
for each row execute function private.audit_row_change();
create trigger staffing_need_skills_audit
after insert or update or delete on app.staffing_need_skills
for each row execute function private.audit_row_change();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into app.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'MOSAIC user'
      ),
      120
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created_mosaic
after insert on auth.users
for each row execute function private.handle_new_auth_user();

insert into app.profiles (id, display_name, avatar_url)
select
  auth_user.id,
  left(
    coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'MOSAIC user'
    ),
    120
  ),
  nullif(auth_user.raw_user_meta_data ->> 'avatar_url', '')
from auth.users as auth_user
on conflict (id) do nothing;

create or replace function public.get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select lower(auth_user.email)
  into v_email
  from auth.users as auth_user
  where auth_user.id = v_user_id;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_user_id,
      'displayName', coalesce(
        profile.display_name,
        nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
        'MOSAIC user'
      ),
      'avatarUrl', profile.avatar_url,
      'locale', coalesce(profile.locale, 'ja-JP'),
      'timeZone', coalesce(profile.time_zone, 'Asia/Tokyo')
    ),
    'organizations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', organization.id,
          'name', organization.name,
          'slug', organization.slug,
          'role', membership.role,
          'workspaceRevision', organization.workspace_revision,
          'accessRevision', organization.access_revision,
          'archivedAt', organization.archived_at
        ) order by organization.name, organization.id
      )
      from app.organization_memberships as membership
      join app.organizations as organization
        on organization.id = membership.organization_id
      where membership.user_id = v_user_id
        and membership.status = 'active'
        and organization.archived_at is null
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', invitation.id,
          'organizationId', invitation.organization_id,
          'organizationName', organization.name,
          'email', invitation.email,
          'role', invitation.role,
          'expiresAt', invitation.expires_at,
          'invitedByName', inviter.display_name
        ) order by invitation.created_at desc, invitation.id
      )
      from app.organization_invitations as invitation
      join app.organizations as organization
        on organization.id = invitation.organization_id
      left join app.profiles as inviter
        on inviter.id = invitation.created_by
      where invitation.normalized_email = v_email
        and invitation.accepted_at is null
        and invitation.revoked_at is null
        and invitation.expires_at > now()
        and organization.archived_at is null
    ), '[]'::jsonb)
  )
  into v_result
  from (select 1) as singleton
  left join app.profiles as profile on profile.id = v_user_id;

  return v_result;
end;
$function$;

comment on function public.get_my_context() is $comment$
Returns:
{
  "profile": {"id","displayName","avatarUrl","locale","timeZone"},
  "organizations": [{"id","name","slug","role","workspaceRevision","accessRevision","archivedAt"}],
  "invitations": [{"id","organizationId","organizationName","email","role","expiresAt","invitedByName"}]
}
Only active memberships and unexpired invitations addressed to the authenticated email are returned.
$comment$;

create or replace function public.create_organization(
  p_name text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := gen_random_uuid();
  v_name text := btrim(p_name);
  v_slug_base text;
  v_slug text;
  v_creation_request app.organization_creation_requests%rowtype;
  v_organization app.organizations%rowtype;
  v_role text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'p_request_id is required';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'organization name must contain 1 to 120 characters';
  end if;

  -- Reserve the actor-scoped request before creating tenant rows. Concurrent
  -- retries serialize on the primary key and observe only a fully committed
  -- request because the reservation and organization share this transaction.
  insert into app.organization_creation_requests (
    actor_user_id,
    request_id,
    requested_name
  ) values (
    v_user_id,
    p_request_id,
    v_name
  )
  on conflict (actor_user_id, request_id) do nothing
  returning * into v_creation_request;

  if not found then
    select creation_request.*
    into v_creation_request
    from app.organization_creation_requests as creation_request
    where creation_request.actor_user_id = v_user_id
      and creation_request.request_id = p_request_id;

    if not found or v_creation_request.organization_id is null then
      raise exception using errcode = '55000', message = 'organization creation request is incomplete';
    end if;
    if v_creation_request.requested_name is distinct from v_name then
      raise exception using errcode = '22023', message = 'p_request_id was already used for a different organization name';
    end if;

    select organization, membership.role
    into v_organization, v_role
    from app.organizations as organization
    join app.organization_memberships as membership
      on membership.organization_id = organization.id
     and membership.user_id = v_user_id
     and membership.status = 'active'
    where organization.id = v_creation_request.organization_id
      and organization.archived_at is null;
    if not found then
      raise exception using errcode = '42501', message = 'not authorized';
    end if;

    return jsonb_build_object(
      'organization', jsonb_build_object(
        'id', v_organization.id,
        'name', v_organization.name,
        'slug', v_organization.slug,
        'role', v_role,
        'workspaceRevision', v_organization.workspace_revision,
        'accessRevision', v_organization.access_revision
      ),
      'requestId', p_request_id,
      'replayed', true
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  v_slug_base := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from v_slug_base);
  if char_length(v_slug_base) < 3 then
    v_slug_base := 'org';
  end if;
  v_slug := left(v_slug_base, 66) || '-' || left(replace(v_organization_id::text, '-', ''), 12);

  insert into app.organizations (
    id,
    name,
    slug,
    workspace_changed_by,
    created_by,
    updated_by
  ) values (
    v_organization_id,
    v_name,
    v_slug,
    v_user_id,
    v_user_id,
    v_user_id
  );

  insert into app.organization_memberships (
    organization_id,
    user_id,
    role,
    status,
    created_by,
    updated_by
  ) values (
    v_organization_id,
    v_user_id,
    'owner',
    'active',
    v_user_id,
    v_user_id
  );

  update app.organization_creation_requests as creation_request
  set
    organization_id = v_organization_id,
    completed_at = now()
  where creation_request.actor_user_id = v_user_id
    and creation_request.request_id = p_request_id;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_organization_id,
      'name', v_name,
      'slug', v_slug,
      'role', 'owner',
      'workspaceRevision', 0,
      'accessRevision', 0
    ),
    'requestId', p_request_id,
    'replayed', false
  );
end;
$function$;

comment on function public.create_organization(text, uuid) is $comment$
Arguments: p_name text, p_request_id uuid generated once per user action.
Returns: {"organization":{"id","name","slug","role","workspaceRevision","accessRevision"},"requestId","replayed"}.
Creates the organization and its first owner membership atomically. Retrying the
same actor/request/name replays the original organization; reusing a request ID
with another name is rejected.
$comment$;

create or replace function public.invite_member(
  p_organization_id uuid,
  p_email text,
  p_role text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_actor_role text;
  v_email text := lower(btrim(p_email));
  v_invitation app.organization_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if v_email is null
     or char_length(v_email) not between 3 and 320
     or position('@' in v_email) <= 1 then
    raise exception using errcode = '22023', message = 'a valid email is required';
  end if;
  if p_role is null or p_role not in ('admin', 'planner', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid invitation role';
  end if;

  -- Serialize invitations for an organization and avoid duplicate pending rows.
  perform 1
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  -- Re-read the actor after the organization lock. Member-management RPCs use
  -- the same lock, so a concurrent demotion/suspension cannot leave a stale
  -- authorization decision in this SECURITY DEFINER function.
  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if p_role = 'admin' and v_actor_role <> 'owner' then
    raise exception using errcode = '42501', message = 'only owners may invite administrators';
  end if;

  if exists (
    select 1
    from app.organization_memberships as membership
    join auth.users as auth_user on auth_user.id = membership.user_id
    where membership.organization_id = p_organization_id
      and membership.status = 'active'
      and lower(auth_user.email) = v_email
  ) then
    raise exception using errcode = '23505', message = 'this email is already an active member';
  end if;
  if exists (
    select 1
    from app.organization_memberships as membership
    join auth.users as auth_user on auth_user.id = membership.user_id
    where membership.organization_id = p_organization_id
      and membership.status = 'suspended'
      and lower(auth_user.email) = v_email
  ) then
    raise exception using errcode = '23514', message = 'a suspended member must be reactivated by an owner or admin';
  end if;

  select invitation.*
  into v_invitation
  from app.organization_invitations as invitation
  where invitation.organization_id = p_organization_id
    and invitation.normalized_email = v_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
  for update;

  if found then
    update app.organization_invitations as invitation
    set
      role = p_role,
      expires_at = now() + interval '7 days',
      updated_by = v_user_id
    where invitation.id = v_invitation.id
    returning invitation.* into v_invitation;
  else
    insert into app.organization_invitations (
      organization_id,
      email,
      role,
      expires_at,
      created_by,
      updated_by
    ) values (
      p_organization_id,
      v_email,
      p_role,
      now() + interval '7 days',
      v_user_id,
      v_user_id
    )
    returning * into v_invitation;
  end if;

  return jsonb_build_object(
    'invitation', jsonb_build_object(
      'id', v_invitation.id,
      'organizationId', v_invitation.organization_id,
      'email', v_invitation.email,
      'role', v_invitation.role,
      'expiresAt', v_invitation.expires_at
    )
  );
end;
$function$;

comment on function public.invite_member(uuid, text, text) is $comment$
Arguments: p_organization_id uuid, p_email text, p_role text ('admin'|'planner'|'viewer').
Returns: {"invitation":{"id","organizationId","email","role","expiresAt"}}.
Owners may invite admins, planners, and viewers. Admins may invite only planners
and viewers. This creates an in-app invitation; email delivery is intentionally
outside the database migration.
$comment$;

create or replace function public.list_organization_invitations(p_organization_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_result jsonb;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  -- Serialize the authorization decision with offboarding and archive writes.
  perform 1
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select jsonb_build_object(
    'invitations', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', invitation.id,
        'organizationId', invitation.organization_id,
        'email', invitation.email,
        'role', invitation.role,
        'expiresAt', invitation.expires_at,
        'createdAt', invitation.created_at,
        'invitedByUserId', invitation.created_by,
        'invitedByName', inviter.display_name,
        'status', case when invitation.expires_at <= now() then 'expired' else 'pending' end
      ) order by invitation.created_at desc, invitation.id
    ), '[]'::jsonb)
  )
  into v_result
  from app.organization_invitations as invitation
  left join app.profiles as inviter on inviter.id = invitation.created_by
  where invitation.organization_id = p_organization_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null;

  return v_result;
end;
$function$;

comment on function public.list_organization_invitations(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns: {"invitations":[{"id","organizationId","email","role","expiresAt","createdAt","invitedByUserId","invitedByName","status":"pending"|"expired"}]}.
Only active owners and admins may list unaccepted, unrevoked invitations.
$comment$;

create or replace function public.revoke_organization_invitation(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_access_revision bigint;
  v_invitation app.organization_invitations%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_invitation_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_invitation_id and p_request_id are required';
  end if;

  -- All access writers lock the organization first. Rechecking the actor after
  -- this lock prevents a concurrently suspended admin from revoking access.
  select organization.access_revision
  into v_access_revision
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select invitation.*
  into v_invitation
  from app.organization_invitations as invitation
  where invitation.organization_id = p_organization_id
    and invitation.id = p_invitation_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation not found';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception using errcode = '23514', message = 'an accepted invitation cannot be revoked';
  end if;
  if v_invitation.revoked_at is not null then
    return jsonb_build_object(
      'changed', false,
      'accessRevision', v_access_revision,
      'requestId', p_request_id,
      'invitation', jsonb_build_object(
        'id', v_invitation.id,
        'organizationId', v_invitation.organization_id,
        'email', v_invitation.email,
        'role', v_invitation.role,
        'expiresAt', v_invitation.expires_at,
        'revokedAt', v_invitation.revoked_at
      )
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  update app.organizations as organization
  set
    access_revision = organization.access_revision + 1,
    updated_by = v_actor_id
  where organization.id = p_organization_id
  returning organization.access_revision into v_access_revision;

  update app.organization_invitations as invitation
  set
    revoked_at = now(),
    updated_by = v_actor_id
  where invitation.organization_id = p_organization_id
    and invitation.id = p_invitation_id
  returning invitation.* into v_invitation;

  return jsonb_build_object(
    'changed', true,
    'accessRevision', v_access_revision,
    'requestId', p_request_id,
    'invitation', jsonb_build_object(
      'id', v_invitation.id,
      'organizationId', v_invitation.organization_id,
      'email', v_invitation.email,
      'role', v_invitation.role,
      'expiresAt', v_invitation.expires_at,
      'revokedAt', v_invitation.revoked_at
    )
  );
end;
$function$;

comment on function public.revoke_organization_invitation(uuid, uuid, uuid) is $comment$
Arguments: p_organization_id uuid, p_invitation_id uuid, p_request_id uuid.
Returns: {"changed","accessRevision","requestId","invitation":{"id","organizationId","email","role","expiresAt","revokedAt"}}.
Only an active owner/admin can revoke. Retrying an already revoked invitation is
a no-op; accepted invitations cannot be revoked.
$comment$;

create or replace function public.accept_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_organization_id uuid;
  v_invitation app.organization_invitations%rowtype;
  v_organization app.organizations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select lower(auth_user.email)
  into v_email
  from auth.users as auth_user
  where auth_user.id = v_user_id;

  select invitation.organization_id
  into v_organization_id
  from app.organization_invitations as invitation
  join app.organizations as organization
    on organization.id = invitation.organization_id
   and organization.archived_at is null
  where invitation.id = p_invitation_id
    and invitation.normalized_email = v_email;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation not found or not available';
  end if;

  -- All membership writers lock organization first, then invitation/membership.
  select organization.*
  into v_organization
  from app.organizations as organization
  where organization.id = v_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation not found or not available';
  end if;

  select invitation.*
  into v_invitation
  from app.organization_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.organization_id = v_organization_id
    and invitation.normalized_email = v_email
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invitation not found or not available';
  end if;

  if v_invitation.accepted_at is not null then
    if v_invitation.accepted_by <> v_user_id then
      raise exception using errcode = 'P0002', message = 'invitation not found or not available';
    end if;
  elsif v_invitation.revoked_at is not null or v_invitation.expires_at <= now() then
    raise exception using errcode = 'P0002', message = 'invitation not found or not available';
  else
    if exists (
      select 1
      from app.organization_memberships as membership
      where membership.organization_id = v_invitation.organization_id
        and membership.user_id = v_user_id
        and membership.status = 'suspended'
    ) then
      raise exception using errcode = '42501', message = 'a suspended membership requires administrator reactivation';
    end if;

    insert into app.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      created_by,
      updated_by
    ) values (
      v_invitation.organization_id,
      v_user_id,
      v_invitation.role,
      'active',
      v_invitation.created_by,
      v_user_id
    )
    on conflict (organization_id, user_id) do update
    set
      role = excluded.role,
      status = 'active',
      updated_by = v_user_id;

    update app.organization_invitations as invitation
    set
      accepted_at = now(),
      accepted_by = v_user_id,
      updated_by = v_user_id
    where invitation.id = v_invitation.id;

    update app.organizations as organization
    set
      access_revision = organization.access_revision + 1,
      updated_by = v_user_id
    where organization.id = v_invitation.organization_id;
  end if;

  select organization.*
  into v_organization
  from app.organizations as organization
  where organization.id = v_invitation.organization_id;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_organization.id,
      'name', v_organization.name,
      'slug', v_organization.slug,
      'role', v_invitation.role,
      'workspaceRevision', v_organization.workspace_revision,
      'accessRevision', v_organization.access_revision
    )
  );
end;
$function$;

comment on function public.accept_invitation(uuid) is $comment$
Arguments: p_invitation_id uuid.
Returns: {"organization":{"id","name","slug","role","workspaceRevision","accessRevision"}}.
The invitation email must exactly match the authenticated Supabase Auth email. Re-accepting the same invitation by the same user is idempotent.
$comment$;

create or replace function public.list_organization_members(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select jsonb_build_object(
    'members', coalesce(jsonb_agg(
      jsonb_build_object(
        'membershipId', membership.id,
        'userId', membership.user_id,
        'displayName', coalesce(profile.display_name, 'MOSAIC user'),
        'avatarUrl', profile.avatar_url,
        'role', membership.role,
        'status', membership.status,
        'joinedAt', membership.joined_at
      ) order by
        case membership.role
          when 'owner' then 1
          when 'admin' then 2
          when 'planner' then 3
          else 4
        end,
        profile.display_name,
        membership.id
    ), '[]'::jsonb)
  )
  into v_result
  from app.organization_memberships as membership
  left join app.profiles as profile on profile.id = membership.user_id
  where membership.organization_id = p_organization_id;

  return v_result;
end;
$function$;

comment on function public.list_organization_members(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns: {"members":[{"membershipId","userId","displayName","avatarUrl","role","status","joinedAt"}]}.
$comment$;

create or replace function public.manage_organization_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text,
  p_status text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target app.organization_memberships%rowtype;
  v_access_revision bigint;
  v_display_name text;
  v_target_email text;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'p_user_id and p_request_id are required';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'planner', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid membership role';
  end if;
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'invalid membership status';
  end if;
  if p_role = 'owner' and p_status <> 'active' then
    raise exception using errcode = '22023', message = 'an owner membership must remain active';
  end if;
  if p_user_id = v_actor_id then
    raise exception using errcode = '42501', message = 'self membership changes require another active owner';
  end if;

  -- Serialize every membership writer on the organization row. This also
  -- prevents two owners from concurrently removing the final owners.
  select organization.access_revision
  into v_access_revision
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_actor_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select membership.*
  into v_target
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization member not found';
  end if;

  select profile.display_name
  into v_display_name
  from app.profiles as profile
  where profile.id = p_user_id;
  select lower(auth_user.email)
  into v_target_email
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  if v_actor_role = 'admin' then
    if v_target.role not in ('planner', 'viewer') or p_role <> v_target.role then
      raise exception using errcode = '42501', message = 'admins may only suspend or reactivate planners and viewers';
    end if;
  end if;

  if v_target.role = p_role and v_target.status = p_status then
    return jsonb_build_object(
      'changed', false,
      'accessRevision', v_access_revision,
      'member', jsonb_build_object(
        'membershipId', v_target.id,
        'userId', v_target.user_id,
        'displayName', coalesce(v_display_name, 'MOSAIC user'),
        'role', v_target.role,
        'status', v_target.status,
        'joinedAt', v_target.joined_at
      )
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  update app.organizations as organization
  set
    access_revision = organization.access_revision + 1,
    updated_by = v_actor_id
  where organization.id = p_organization_id
  returning organization.access_revision into v_access_revision;

  update app.organization_memberships as membership
  set
    role = p_role,
    status = p_status,
    updated_by = v_actor_id
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
  returning membership.* into v_target;

  if p_status = 'suspended' and v_target_email is not null then
    update app.organization_invitations as invitation
    set
      revoked_at = coalesce(invitation.revoked_at, now()),
      updated_by = v_actor_id
    where invitation.organization_id = p_organization_id
      and invitation.normalized_email = v_target_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null;
  end if;

  return jsonb_build_object(
    'changed', true,
    'accessRevision', v_access_revision,
    'member', jsonb_build_object(
      'membershipId', v_target.id,
      'userId', v_target.user_id,
      'displayName', coalesce(v_display_name, 'MOSAIC user'),
      'role', v_target.role,
      'status', v_target.status,
      'joinedAt', v_target.joined_at
    )
  );
end;
$function$;

comment on function public.manage_organization_member(uuid, uuid, text, text, uuid) is $comment$
Arguments: organization, target user, desired role/status, and client request UUID.
Owners may change another member's role or status. Admins may only suspend or
reactivate planners and viewers. Self changes and a suspended owner are rejected;
the last-owner trigger remains the final invariant. Returns changed=false for a
retry that already reached the desired state.
$comment$;

create or replace function public.list_audit_events(
  p_organization_id uuid,
  p_limit integer default 50,
  p_before bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.has_org_role(p_organization_id, array['owner', 'admin']::text[]) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_limit < 1 or v_limit > 200 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 200';
  end if;

  with page as (
    select audit.*
    from app.audit_events as audit
    where audit.organization_id = p_organization_id
      and (p_before is null or audit.id < p_before)
    order by audit.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'occurredAt', page.occurred_at,
        'actorUserId', page.actor_user_id,
        'actorName', actor.display_name,
        'action', page.action,
        'entityType', page.entity_type,
        'entityId', page.entity_id,
        'entityKey', page.entity_key,
        'requestId', page.request_id,
        'workspaceRevision', page.workspace_revision,
        'oldData', page.old_data,
        'newData', page.new_data
      ) order by page.id desc
    ), '[]'::jsonb),
    'nextBefore', case when count(page.id) = v_limit then min(page.id) else null end
  )
  into v_result
  from page
  left join app.profiles as actor on actor.id = page.actor_user_id;

  return v_result;
end;
$function$;

comment on function public.list_audit_events(uuid, integer, bigint) is $comment$
Arguments: p_organization_id uuid, p_limit integer (1..200), p_before bigint cursor (exclusive).
Returns: {"items":[{"id","occurredAt","actorUserId","actorName","action","entityType","entityId","entityKey","requestId","workspaceRevision","oldData","newData"}],"nextBefore":bigint|null}.
Only owners and admins may read audit events.
$comment$;

create or replace function public.get_workspace(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  -- One SELECT produces the revision and all child collections from one
  -- statement snapshot. Clients must not rebuild a workspace from several
  -- independent REST calls.
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization.id,
      'name', organization.name,
      'slug', organization.slug,
      'workspaceRevision', organization.workspace_revision,
      'workspaceChangedAt', organization.workspace_changed_at,
      'workspaceChangedBy', organization.workspace_changed_by
    ),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', person.id,
          'authUserId', person.user_id,
          'employeeCode', person.employee_code,
          'initials', person.initials,
          'name', person.name,
          'role', person.role_title,
          'department', person.department,
          'avatarTone', person.avatar_tone,
          'skills', coalesce((
            select jsonb_agg(skill.name order by skill.normalized_name, skill.id)
            from app.person_skills as person_skill
            join app.skills as skill
              on skill.organization_id = person_skill.organization_id
             and skill.id = person_skill.skill_id
            where person_skill.organization_id = person.organization_id
              and person_skill.person_id = person.id
          ), '[]'::jsonb),
          'location', person.location,
          'capacity', person.capacity_percent,
          'isActive', person.is_active,
          'version', person.version
        ) order by person.name, person.id
      )
      from app.people as person
      where person.organization_id = organization.id
        and person.is_active
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', project.id,
          'code', project.code,
          'name', project.name,
          'summary', project.summary,
          'status', project.status,
          'tone', project.tone,
          'ownerPersonId', project.owner_person_id,
          'ownerName', owner.name,
          'ownerInitials', owner.initials,
          'startDate', project.start_date,
          'endDate', project.end_date,
          'nextMilestone', project.next_milestone,
          'nextMilestoneDate', project.next_milestone_date,
          'progress', project.progress_percent,
          'demand', project.demand_headcount,
          'version', project.version
        ) order by project.start_date, project.name, project.id
      )
      from app.projects as project
      left join app.people as owner
        on owner.organization_id = project.organization_id
       and owner.id = project.owner_person_id
      where project.organization_id = organization.id
        and project.archived_at is null
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', assignment.id,
          'personId', assignment.person_id,
          'projectId', assignment.project_id,
          'staffingNeedId', assignment.staffing_need_id,
          'startDate', assignment.start_date,
          'endDate', assignment.end_date,
          'allocation', assignment.allocation_percent,
          'status', assignment.status,
          'label', assignment.label,
          'version', assignment.version
        ) order by assignment.start_date, assignment.id
      )
      from app.assignments as assignment
      where assignment.organization_id = organization.id
        and assignment.status <> 'cancelled'
    ), '[]'::jsonb),
    'needs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', need.id,
          'projectId', need.project_id,
          'role', need.role_title,
          'skills', coalesce((
            select jsonb_agg(skill.name order by skill.normalized_name, skill.id)
            from app.staffing_need_skills as need_skill
            join app.skills as skill
              on skill.organization_id = need_skill.organization_id
             and skill.id = need_skill.skill_id
            where need_skill.organization_id = need.organization_id
              and need_skill.staffing_need_id = need.id
          ), '[]'::jsonb),
          'startDate', need.start_date,
          'endDate', need.end_date,
          'allocation', need.allocation_percent,
          'status', need.status,
          'draftPersonId', need.draft_person_id,
          'version', need.version
        ) order by need.start_date, need.id
      )
      from app.staffing_needs as need
      where need.organization_id = organization.id
        and need.status <> 'cancelled'
    ), '[]'::jsonb)
  )
  into v_result
  from app.organizations as organization
  where organization.id = p_organization_id
    and organization.archived_at is null;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'organization not found';
  end if;

  return v_result;
end;
$function$;

comment on function public.get_workspace(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns one consistent snapshot:
{
  "organization":{"id","name","slug","workspaceRevision","workspaceChangedAt","workspaceChangedBy"},
  "members":[{"id","authUserId","employeeCode","initials","name","role","department","avatarTone","skills":[],"location","capacity","isActive","version"}],
  "projects":[{"id","code","name","summary","status","tone","ownerPersonId","ownerName","ownerInitials","startDate","endDate","nextMilestone","nextMilestoneDate","progress","demand","version"}],
  "assignments":[{"id","personId","projectId","staffingNeedId","startDate","endDate","allocation","status","label","version"}],
  "needs":[{"id","projectId","role","skills":[],"startDate","endDate","allocation","status","draftPersonId","version"}]
}
Archived people/projects and cancelled assignments/needs are omitted.
$comment$;

create or replace function private.payload_array(p_payload jsonb, p_path text[])
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_value jsonb := p_payload #> p_path;
begin
  if v_value is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(v_value) <> 'array' then
    raise exception using
      errcode = '22023',
      message = array_to_string(p_path, '.') || ' must be a JSON array';
  end if;
  return v_value;
end;
$function$;

create or replace function private.get_or_create_skill(
  p_organization_id uuid,
  p_name text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_name text := btrim(p_name);
  v_skill_id uuid;
begin
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'skill names must contain 1 to 80 characters';
  end if;

  insert into app.skills (
    organization_id,
    name,
    created_by,
    updated_by
  ) values (
    p_organization_id,
    v_name,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (organization_id, normalized_name) do nothing
  returning id into v_skill_id;

  if v_skill_id is null then
    select skill.id
    into v_skill_id
    from app.skills as skill
    where skill.organization_id = p_organization_id
      and skill.normalized_name = lower(v_name);
  end if;

  return v_skill_id;
end;
$function$;

revoke all on function private.payload_array(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.get_or_create_skill(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.save_workspace(
  p_organization_id uuid,
  p_expected_revision bigint,
  p_request_id uuid,
  p_payload jsonb,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_actor_role text;
  v_new_revision bigint;
  v_current_revision bigint;
  v_saved_at timestamptz := now();
  v_server_digest text;
  v_commit app.workspace_commits%rowtype;
  v_item jsonb;
  v_scalar jsonb;
  v_skill_json jsonb;
  v_id uuid;
  v_skill_id uuid;
  v_owner_person_id uuid;
  v_staffing_need_id uuid;
  v_skill_name text;
  v_text text;
  v_affected integer;
  v_members_upsert jsonb;
  v_members_archive jsonb;
  v_projects_upsert jsonb;
  v_projects_archive jsonb;
  v_assignments_upsert jsonb;
  v_assignments_cancel jsonb;
  v_needs_upsert jsonb;
  v_needs_cancel jsonb;
  v_total_items integer;
  v_summary jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not private.has_org_role(
    p_organization_id,
    array['owner', 'admin', 'planner']::text[]
  ) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'p_expected_revision must be zero or greater';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'p_request_id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'p_payload must be a JSON object';
  end if;
  if octet_length(p_payload::text) > 1048576 then
    raise exception using errcode = '54000', message = 'p_payload exceeds the 1 MiB limit';
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'p_payload_hash must be lowercase SHA-256 hex';
  end if;
  if (p_payload - array['members', 'projects', 'assignments', 'needs']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'p_payload contains unsupported top-level keys';
  end if;

  if p_payload ? 'members' and jsonb_typeof(p_payload -> 'members') <> 'object' then
    raise exception using errcode = '22023', message = 'members must be a JSON object';
  end if;
  if p_payload ? 'projects' and jsonb_typeof(p_payload -> 'projects') <> 'object' then
    raise exception using errcode = '22023', message = 'projects must be a JSON object';
  end if;
  if p_payload ? 'assignments' and jsonb_typeof(p_payload -> 'assignments') <> 'object' then
    raise exception using errcode = '22023', message = 'assignments must be a JSON object';
  end if;
  if p_payload ? 'needs' and jsonb_typeof(p_payload -> 'needs') <> 'object' then
    raise exception using errcode = '22023', message = 'needs must be a JSON object';
  end if;
  if (coalesce(p_payload -> 'members', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'members contains unsupported keys';
  end if;
  if (coalesce(p_payload -> 'projects', '{}'::jsonb) - array['upsert', 'archiveIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'projects contains unsupported keys';
  end if;
  if (coalesce(p_payload -> 'assignments', '{}'::jsonb) - array['upsert', 'cancelIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'assignments contains unsupported keys';
  end if;
  if (coalesce(p_payload -> 'needs', '{}'::jsonb) - array['upsert', 'cancelIds']::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'needs contains unsupported keys';
  end if;

  v_members_upsert := private.payload_array(p_payload, array['members', 'upsert']::text[]);
  v_members_archive := private.payload_array(p_payload, array['members', 'archiveIds']::text[]);
  v_projects_upsert := private.payload_array(p_payload, array['projects', 'upsert']::text[]);
  v_projects_archive := private.payload_array(p_payload, array['projects', 'archiveIds']::text[]);
  v_assignments_upsert := private.payload_array(p_payload, array['assignments', 'upsert']::text[]);
  v_assignments_cancel := private.payload_array(p_payload, array['assignments', 'cancelIds']::text[]);
  v_needs_upsert := private.payload_array(p_payload, array['needs', 'upsert']::text[]);
  v_needs_cancel := private.payload_array(p_payload, array['needs', 'cancelIds']::text[]);

  v_total_items :=
    jsonb_array_length(v_members_upsert)
    + jsonb_array_length(v_members_archive)
    + jsonb_array_length(v_projects_upsert)
    + jsonb_array_length(v_projects_archive)
    + jsonb_array_length(v_assignments_upsert)
    + jsonb_array_length(v_assignments_cancel)
    + jsonb_array_length(v_needs_upsert)
    + jsonb_array_length(v_needs_cancel);
  if v_total_items > 2000 then
    raise exception using errcode = '54000', message = 'p_payload contains more than 2000 operations';
  end if;
  if v_actor_role = 'planner'
     and (
       jsonb_array_length(v_members_upsert) > 0
       or jsonb_array_length(v_members_archive) > 0
     ) then
    raise exception using
      errcode = '42501',
      message = 'only owners and admins may change members';
  end if;

  v_server_digest := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- A completed request is returned verbatim on a retry. Both the client hash
  -- and a server-computed digest must match, so reusing a request ID for a
  -- different payload fails closed.
  select workspace_commit.*
  into v_commit
  from app.workspace_commits as workspace_commit
  where workspace_commit.organization_id = p_organization_id
    and workspace_commit.request_id = p_request_id;

  if found then
    if v_commit.client_payload_hash <> p_payload_hash
       or v_commit.server_payload_digest <> v_server_digest then
      raise exception using errcode = '22023', message = 'p_request_id was already used for a different payload';
    end if;
    return jsonb_build_object(
      'organizationId', p_organization_id,
      'revision', v_commit.new_revision,
      'requestId', p_request_id,
      'replayed', true,
      'savedAt', v_commit.saved_at
    );
  end if;

  perform set_config('app.request_id', p_request_id::text, true);

  -- Atomic compare-and-swap. This update acquires the organization row lock.
  -- Every workspace writer must use this RPC so the revision remains complete.
  update app.organizations as organization
  set
    workspace_revision = organization.workspace_revision + 1,
    workspace_changed_at = v_saved_at,
    workspace_changed_by = v_user_id,
    updated_by = v_user_id
  where organization.id = p_organization_id
    and organization.workspace_revision = p_expected_revision
    and organization.archived_at is null
  returning organization.workspace_revision into v_new_revision;

  if v_new_revision is null then
    -- A concurrent copy of the same request may have committed while this call
    -- waited for the row lock. Re-read idempotency before reporting a conflict.
    select workspace_commit.*
    into v_commit
    from app.workspace_commits as workspace_commit
    where workspace_commit.organization_id = p_organization_id
      and workspace_commit.request_id = p_request_id;

    if found then
      if v_commit.client_payload_hash <> p_payload_hash
         or v_commit.server_payload_digest <> v_server_digest then
        raise exception using errcode = '22023', message = 'p_request_id was already used for a different payload';
      end if;
      return jsonb_build_object(
        'organizationId', p_organization_id,
        'revision', v_commit.new_revision,
        'requestId', p_request_id,
        'replayed', true,
        'savedAt', v_commit.saved_at
      );
    end if;

    select organization.workspace_revision
    into v_current_revision
    from app.organizations as organization
    where organization.id = p_organization_id;

    raise exception using
      errcode = '40001',
      message = 'workspace revision conflict',
      detail = 'expected=' || p_expected_revision::text || ', current=' || coalesce(v_current_revision::text, 'not-found');
  end if;

  -- Recheck access after acquiring the organization lock. If an offboarding
  -- operation won the lock first, this exception rolls the CAS update back.
  select membership.role
  into v_actor_role
  from app.organization_memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = v_user_id
    and membership.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin', 'planner') then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;
  if v_actor_role = 'planner'
     and (
       jsonb_array_length(v_members_upsert) > 0
       or jsonb_array_length(v_members_archive) > 0
     ) then
    raise exception using errcode = '42501', message = 'only owners and admins may change members';
  end if;

  -- Members are applied first because projects, needs, and assignments may
  -- reference them. Upsert objects are complete rows; server-owned audit and
  -- version fields are ignored.
  for v_item in
    select value from jsonb_array_elements(v_members_upsert)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'members.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;

    insert into app.people (
      id,
      organization_id,
      user_id,
      employee_code,
      initials,
      name,
      role_title,
      department,
      avatar_tone,
      location,
      capacity_percent,
      is_active,
      created_by,
      updated_by
    ) values (
      v_id,
      p_organization_id,
      nullif(v_item ->> 'authUserId', '')::uuid,
      nullif(btrim(v_item ->> 'employeeCode'), ''),
      btrim(v_item ->> 'initials'),
      btrim(v_item ->> 'name'),
      btrim(v_item ->> 'role'),
      btrim(v_item ->> 'department'),
      coalesce(nullif(v_item ->> 'avatarTone', ''), 'lavender'),
      btrim(v_item ->> 'location'),
      (v_item ->> 'capacity')::numeric,
      coalesce((v_item ->> 'isActive')::boolean, true),
      v_user_id,
      v_user_id
    )
    on conflict (id) do update
    set
      user_id = coalesce(excluded.user_id, app.people.user_id),
      employee_code = coalesce(excluded.employee_code, app.people.employee_code),
      initials = excluded.initials,
      name = excluded.name,
      role_title = excluded.role_title,
      department = excluded.department,
      avatar_tone = excluded.avatar_tone,
      location = excluded.location,
      capacity_percent = excluded.capacity_percent,
      is_active = case
        when v_item ? 'isActive' then excluded.is_active
        else app.people.is_active
      end,
      updated_by = v_user_id
    where app.people.organization_id = p_organization_id
      and row(
        app.people.user_id,
        app.people.employee_code,
        app.people.initials,
        app.people.name,
        app.people.role_title,
        app.people.department,
        app.people.avatar_tone,
        app.people.location,
        app.people.capacity_percent,
        app.people.is_active
      ) is distinct from row(
        coalesce(excluded.user_id, app.people.user_id),
        coalesce(excluded.employee_code, app.people.employee_code),
        excluded.initials,
        excluded.name,
        excluded.role_title,
        excluded.department,
        excluded.avatar_tone,
        excluded.location,
        excluded.capacity_percent,
        case
          when v_item ? 'isActive' then excluded.is_active
          else app.people.is_active
        end
      );
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.people as existing_person
      where existing_person.organization_id = p_organization_id
        and existing_person.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'member id is not valid for this organization';
    end if;

    delete from app.person_skills as person_skill
    using app.skills as skill
    where person_skill.organization_id = p_organization_id
      and person_skill.person_id = v_id
      and skill.organization_id = person_skill.organization_id
      and skill.id = person_skill.skill_id
      and not exists (
        select 1
        from jsonb_array_elements_text(
          private.payload_array(v_item, array['skills']::text[])
        ) as desired_skill(name)
        where lower(btrim(desired_skill.name)) = skill.normalized_name
      );

    for v_skill_json in
      select value from jsonb_array_elements(private.payload_array(v_item, array['skills']::text[]))
    loop
      v_skill_name := btrim(v_skill_json #>> '{}');
      v_skill_id := private.get_or_create_skill(p_organization_id, v_skill_name, v_user_id);
      insert into app.person_skills (
        organization_id,
        person_id,
        skill_id,
        created_by
      ) values (
        p_organization_id,
        v_id,
        v_skill_id,
        v_user_id
      ) on conflict do nothing;
    end loop;
  end loop;

  for v_scalar in
    select value from jsonb_array_elements(v_members_archive)
  loop
    v_text := v_scalar #>> '{}';
    update app.people as person
    set is_active = false, updated_by = v_user_id
    where person.organization_id = p_organization_id
      and person.id = v_text::uuid;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'members.archiveIds contains an unknown id';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(v_projects_upsert)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'projects.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_owner_person_id := nullif(v_item ->> 'ownerPersonId', '')::uuid;
    if v_owner_person_id is null then
      select existing_project.owner_person_id
      into v_owner_person_id
      from app.projects as existing_project
      where existing_project.organization_id = p_organization_id
        and existing_project.id = v_id;
    end if;
    if v_owner_person_id is null and nullif(btrim(v_item ->> 'ownerName'), '') is not null then
      select person.id
      into v_owner_person_id
      from app.people as person
      where person.organization_id = p_organization_id
        and person.name = btrim(v_item ->> 'ownerName')
        and person.is_active
      order by person.id
      limit 1;
    end if;

    insert into app.projects (
      id,
      organization_id,
      code,
      name,
      summary,
      status,
      tone,
      owner_person_id,
      start_date,
      end_date,
      next_milestone,
      next_milestone_date,
      progress_percent,
      demand_headcount,
      archived_at,
      created_by,
      updated_by
    ) values (
      v_id,
      p_organization_id,
      upper(btrim(v_item ->> 'code')),
      btrim(v_item ->> 'name'),
      coalesce(v_item ->> 'summary', ''),
      v_item ->> 'status',
      coalesce(nullif(v_item ->> 'tone', ''), 'blue'),
      v_owner_person_id,
      (v_item ->> 'startDate')::date,
      (v_item ->> 'endDate')::date,
      coalesce(v_item ->> 'nextMilestone', ''),
      nullif(v_item ->> 'nextMilestoneDate', '')::date,
      (v_item ->> 'progress')::numeric,
      (v_item ->> 'demand')::integer,
      case when v_item ->> 'status' = 'アーカイブ' then now() else null end,
      v_user_id,
      v_user_id
    )
    on conflict (id) do update
    set
      code = excluded.code,
      name = excluded.name,
      summary = excluded.summary,
      status = excluded.status,
      tone = excluded.tone,
      owner_person_id = case
        when v_owner_person_id is not null then v_owner_person_id
        else app.projects.owner_person_id
      end,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      next_milestone = excluded.next_milestone,
      next_milestone_date = excluded.next_milestone_date,
      progress_percent = excluded.progress_percent,
      demand_headcount = excluded.demand_headcount,
      archived_at = case
        when excluded.status = 'アーカイブ' then coalesce(app.projects.archived_at, now())
        else null
      end,
      updated_by = v_user_id
    where app.projects.organization_id = p_organization_id
      and row(
        app.projects.code,
        app.projects.name,
        app.projects.summary,
        app.projects.status,
        app.projects.tone,
        app.projects.owner_person_id,
        app.projects.start_date,
        app.projects.end_date,
        app.projects.next_milestone,
        app.projects.next_milestone_date,
        app.projects.progress_percent,
        app.projects.demand_headcount,
        app.projects.archived_at
      ) is distinct from row(
        excluded.code,
        excluded.name,
        excluded.summary,
        excluded.status,
        excluded.tone,
        coalesce(v_owner_person_id, app.projects.owner_person_id),
        excluded.start_date,
        excluded.end_date,
        excluded.next_milestone,
        excluded.next_milestone_date,
        excluded.progress_percent,
        excluded.demand_headcount,
        case
          when excluded.status = 'アーカイブ' then coalesce(app.projects.archived_at, now())
          else null
        end
      );
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.projects as existing_project
      where existing_project.organization_id = p_organization_id
        and existing_project.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'project id is not valid for this organization';
    end if;
  end loop;

  for v_scalar in
    select value from jsonb_array_elements(v_projects_archive)
  loop
    v_text := v_scalar #>> '{}';
    update app.projects as project
    set
      status = 'アーカイブ',
      archived_at = coalesce(project.archived_at, now()),
      updated_by = v_user_id
    where project.organization_id = p_organization_id
      and project.id = v_text::uuid;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'projects.archiveIds contains an unknown id';
    end if;
  end loop;

  -- Staffing needs precede assignments so a new assignment can reference a
  -- need created in the same save transaction.
  for v_item in
    select value from jsonb_array_elements(v_needs_upsert)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'needs.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;

    insert into app.staffing_needs (
      id,
      organization_id,
      project_id,
      role_title,
      start_date,
      end_date,
      allocation_percent,
      status,
      draft_person_id,
      created_by,
      updated_by
    ) values (
      v_id,
      p_organization_id,
      (v_item ->> 'projectId')::uuid,
      btrim(v_item ->> 'role'),
      (v_item ->> 'startDate')::date,
      (v_item ->> 'endDate')::date,
      (v_item ->> 'allocation')::numeric,
      v_item ->> 'status',
      nullif(v_item ->> 'draftPersonId', '')::uuid,
      v_user_id,
      v_user_id
    )
    on conflict (id) do update
    set
      project_id = excluded.project_id,
      role_title = excluded.role_title,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      allocation_percent = excluded.allocation_percent,
      status = excluded.status,
      draft_person_id = case
        when v_item ? 'draftPersonId' then excluded.draft_person_id
        else app.staffing_needs.draft_person_id
      end,
      updated_by = v_user_id
    where app.staffing_needs.organization_id = p_organization_id
      and row(
        app.staffing_needs.project_id,
        app.staffing_needs.role_title,
        app.staffing_needs.start_date,
        app.staffing_needs.end_date,
        app.staffing_needs.allocation_percent,
        app.staffing_needs.status,
        app.staffing_needs.draft_person_id
      ) is distinct from row(
        excluded.project_id,
        excluded.role_title,
        excluded.start_date,
        excluded.end_date,
        excluded.allocation_percent,
        excluded.status,
        case
          when v_item ? 'draftPersonId' then excluded.draft_person_id
          else app.staffing_needs.draft_person_id
        end
      );
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.staffing_needs as existing_need
      where existing_need.organization_id = p_organization_id
        and existing_need.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'staffing need id is not valid for this organization';
    end if;

    delete from app.staffing_need_skills as need_skill
    using app.skills as skill
    where need_skill.organization_id = p_organization_id
      and need_skill.staffing_need_id = v_id
      and skill.organization_id = need_skill.organization_id
      and skill.id = need_skill.skill_id
      and not exists (
        select 1
        from jsonb_array_elements_text(
          private.payload_array(v_item, array['skills']::text[])
        ) as desired_skill(name)
        where lower(btrim(desired_skill.name)) = skill.normalized_name
      );

    for v_skill_json in
      select value from jsonb_array_elements(private.payload_array(v_item, array['skills']::text[]))
    loop
      v_skill_name := btrim(v_skill_json #>> '{}');
      v_skill_id := private.get_or_create_skill(p_organization_id, v_skill_name, v_user_id);
      insert into app.staffing_need_skills (
        organization_id,
        staffing_need_id,
        skill_id,
        created_by
      ) values (
        p_organization_id,
        v_id,
        v_skill_id,
        v_user_id
      ) on conflict do nothing;
    end loop;
  end loop;

  for v_scalar in
    select value from jsonb_array_elements(v_needs_cancel)
  loop
    v_text := v_scalar #>> '{}';
    update app.staffing_needs as need
    set
      status = 'cancelled',
      draft_person_id = null,
      updated_by = v_user_id
    where need.organization_id = p_organization_id
      and need.id = v_text::uuid;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'needs.cancelIds contains an unknown id';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(v_assignments_upsert)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'assignments.upsert entries must be objects';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_staffing_need_id := null;
    if not (v_item ? 'staffingNeedId') then
      select existing_assignment.staffing_need_id
      into v_staffing_need_id
      from app.assignments as existing_assignment
      where existing_assignment.organization_id = p_organization_id
        and existing_assignment.id = v_id;
      if v_staffing_need_id is null then
        select need.id
        into v_staffing_need_id
        from app.staffing_needs as need
        where need.organization_id = p_organization_id
          and need.project_id = (v_item ->> 'projectId')::uuid
          and need.draft_person_id = (v_item ->> 'personId')::uuid
          and need.start_date = (v_item ->> 'startDate')::date
          and need.end_date = (v_item ->> 'endDate')::date
          and need.allocation_percent = (v_item ->> 'allocation')::numeric
          and need.status in ('planned', 'filled')
        order by need.id
        limit 1;
      end if;
    else
      -- An explicit JSON null or empty string detaches the assignment. Only a
      -- missing key preserves an existing link or invokes legacy matching.
      v_staffing_need_id := nullif(v_item ->> 'staffingNeedId', '')::uuid;
    end if;

    insert into app.assignments (
      id,
      organization_id,
      person_id,
      project_id,
      staffing_need_id,
      start_date,
      end_date,
      allocation_percent,
      status,
      label,
      client_request_id,
      confirmed_at,
      confirmed_by,
      created_by,
      updated_by
    ) values (
      v_id,
      p_organization_id,
      (v_item ->> 'personId')::uuid,
      (v_item ->> 'projectId')::uuid,
      v_staffing_need_id,
      (v_item ->> 'startDate')::date,
      (v_item ->> 'endDate')::date,
      (v_item ->> 'allocation')::numeric,
      v_item ->> 'status',
      nullif(v_item ->> 'label', ''),
      nullif(v_item ->> 'clientRequestId', '')::uuid,
      case when v_item ->> 'status' = 'confirmed' then now() else null end,
      case when v_item ->> 'status' = 'confirmed' then v_user_id else null end,
      v_user_id,
      v_user_id
    )
    on conflict (id) do update
    set
      person_id = excluded.person_id,
      project_id = excluded.project_id,
      staffing_need_id = excluded.staffing_need_id,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      allocation_percent = excluded.allocation_percent,
      status = excluded.status,
      label = case
        when v_item ? 'label' then excluded.label
        else app.assignments.label
      end,
      client_request_id = case
        when v_item ? 'clientRequestId' then excluded.client_request_id
        else app.assignments.client_request_id
      end,
      confirmed_at = case
        when excluded.status = 'confirmed' then coalesce(app.assignments.confirmed_at, now())
        else app.assignments.confirmed_at
      end,
      confirmed_by = case
        when excluded.status = 'confirmed' then coalesce(app.assignments.confirmed_by, v_user_id)
        else app.assignments.confirmed_by
      end,
      updated_by = v_user_id
    where app.assignments.organization_id = p_organization_id
      and row(
        app.assignments.person_id,
        app.assignments.project_id,
        app.assignments.staffing_need_id,
        app.assignments.start_date,
        app.assignments.end_date,
        app.assignments.allocation_percent,
        app.assignments.status,
        app.assignments.label,
        app.assignments.client_request_id
      ) is distinct from row(
        excluded.person_id,
        excluded.project_id,
        excluded.staffing_need_id,
        excluded.start_date,
        excluded.end_date,
        excluded.allocation_percent,
        excluded.status,
        case
          when v_item ? 'label' then excluded.label
          else app.assignments.label
        end,
        case
          when v_item ? 'clientRequestId' then excluded.client_request_id
          else app.assignments.client_request_id
        end
      );
    get diagnostics v_affected = row_count;
    if v_affected = 0 and not exists (
      select 1 from app.assignments as existing_assignment
      where existing_assignment.organization_id = p_organization_id
        and existing_assignment.id = v_id
    ) then
      raise exception using errcode = '22023', message = 'assignment id is not valid for this organization';
    end if;
  end loop;

  for v_scalar in
    select value from jsonb_array_elements(v_assignments_cancel)
  loop
    v_text := v_scalar #>> '{}';
    update app.assignments as assignment
    set status = 'cancelled', updated_by = v_user_id
    where assignment.organization_id = p_organization_id
      and assignment.id = v_text::uuid;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '22023', message = 'assignments.cancelIds contains an unknown id';
    end if;
  end loop;

  -- Archive/cancel operations are accepted only when the resulting workspace
  -- remains internally readable. Because these checks run before the commit
  -- ledger insert, any failure rolls back the row changes and revision CAS.
  if exists (
    select 1
    from app.assignments as assignment
    join app.people as person
      on person.organization_id = assignment.organization_id
     and person.id = assignment.person_id
    join app.projects as project
      on project.organization_id = assignment.organization_id
     and project.id = assignment.project_id
    where assignment.organization_id = p_organization_id
      and assignment.status <> 'cancelled'
      and (not person.is_active or project.archived_at is not null)
  ) then
    raise exception using
      errcode = '22023',
      message = 'active assignments cannot reference inactive members or archived projects';
  end if;

  if exists (
    select 1
    from app.staffing_needs as need
    join app.projects as project
      on project.organization_id = need.organization_id
     and project.id = need.project_id
    where need.organization_id = p_organization_id
      and need.status <> 'cancelled'
      and project.archived_at is not null
  ) then
    raise exception using
      errcode = '22023',
      message = 'active staffing needs cannot reference archived projects';
  end if;

  if exists (
    select 1
    from app.projects as project
    left join app.people as owner_person
      on owner_person.organization_id = project.organization_id
     and owner_person.id = project.owner_person_id
    where project.organization_id = p_organization_id
      and project.archived_at is null
      and project.owner_person_id is not null
      and (owner_person.id is null or not owner_person.is_active)
  ) then
    raise exception using
      errcode = '22023',
      message = 'active projects cannot reference inactive owner members';
  end if;

  if exists (
    select 1
    from app.assignments as assignment
    join app.projects as project
      on project.organization_id = assignment.organization_id
     and project.id = assignment.project_id
    where assignment.organization_id = p_organization_id
      and assignment.status <> 'cancelled'
      and (
        assignment.start_date < project.start_date
        or assignment.end_date > project.end_date
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'active assignment periods must be contained by their projects';
  end if;

  if exists (
    select 1
    from app.staffing_needs as need
    join app.projects as project
      on project.organization_id = need.organization_id
     and project.id = need.project_id
    where need.organization_id = p_organization_id
      and need.status <> 'cancelled'
      and (
        need.start_date < project.start_date
        or need.end_date > project.end_date
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'active staffing need periods must be contained by their projects';
  end if;

  if exists (
    select 1
    from app.staffing_needs as need
    where need.organization_id = p_organization_id
      and need.status in ('open', 'cancelled')
      and (
        need.draft_person_id is not null
        or exists (
          select 1
          from app.assignments as linked_assignment
          where linked_assignment.organization_id = need.organization_id
            and linked_assignment.staffing_need_id = need.id
            and linked_assignment.status <> 'cancelled'
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'open or cancelled staffing needs cannot retain a draft person or active linked assignment';
  end if;

  if exists (
    select assignment.staffing_need_id
    from app.assignments as assignment
    where assignment.organization_id = p_organization_id
      and assignment.staffing_need_id is not null
      and assignment.status <> 'cancelled'
    group by assignment.staffing_need_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'a staffing need can have at most one active linked assignment';
  end if;

  if exists (
    select 1
    from app.staffing_needs as need
    left join app.people as draft_person
      on draft_person.organization_id = need.organization_id
     and draft_person.id = need.draft_person_id
    where need.organization_id = p_organization_id
      and need.status in ('planned', 'filled')
      and (
        need.draft_person_id is null
        or draft_person.id is null
        or not draft_person.is_active
        or lower(btrim(draft_person.role_title)) <> lower(btrim(need.role_title))
        or exists (
          select 1
          from app.staffing_need_skills as required_skill
          where required_skill.organization_id = need.organization_id
            and required_skill.staffing_need_id = need.id
            and not exists (
              select 1
              from app.person_skills as qualified_skill
              where qualified_skill.organization_id = need.organization_id
                and qualified_skill.person_id = need.draft_person_id
                and qualified_skill.skill_id = required_skill.skill_id
            )
        )
        or not exists (
          select 1
          from app.assignments as linked_assignment
          where linked_assignment.organization_id = need.organization_id
            and linked_assignment.staffing_need_id = need.id
            and linked_assignment.person_id = need.draft_person_id
            and linked_assignment.project_id = need.project_id
            and linked_assignment.status <> 'cancelled'
            and (
              (need.status = 'planned' and linked_assignment.status = 'draft')
              or (need.status = 'filled' and linked_assignment.status = 'confirmed')
            )
            and linked_assignment.start_date <= need.start_date
            and linked_assignment.end_date >= need.end_date
            and linked_assignment.allocation_percent >= need.allocation_percent
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'planned or filled staffing needs require one matching active assignment and qualified draft person';
  end if;

  v_summary := jsonb_build_object(
    'membersUpserted', jsonb_array_length(v_members_upsert),
    'membersArchived', jsonb_array_length(v_members_archive),
    'projectsUpserted', jsonb_array_length(v_projects_upsert),
    'projectsArchived', jsonb_array_length(v_projects_archive),
    'assignmentsUpserted', jsonb_array_length(v_assignments_upsert),
    'assignmentsCancelled', jsonb_array_length(v_assignments_cancel),
    'needsUpserted', jsonb_array_length(v_needs_upsert),
    'needsCancelled', jsonb_array_length(v_needs_cancel)
  );

  insert into app.workspace_commits (
    organization_id,
    request_id,
    expected_revision,
    new_revision,
    client_payload_hash,
    server_payload_digest,
    actor_user_id,
    summary,
    saved_at
  ) values (
    p_organization_id,
    p_request_id,
    p_expected_revision,
    v_new_revision,
    p_payload_hash,
    v_server_digest,
    v_user_id,
    v_summary,
    v_saved_at
  );

  return jsonb_build_object(
    'organizationId', p_organization_id,
    'revision', v_new_revision,
    'requestId', p_request_id,
    'replayed', false,
    'savedAt', v_saved_at
  );
end;
$function$;

comment on function public.save_workspace(uuid, bigint, uuid, jsonb, text) is $comment$
Arguments:
  p_organization_id uuid
  p_expected_revision bigint
  p_request_id uuid (new crypto.randomUUID per logical save; reuse only for retry)
  p_payload jsonb
  p_payload_hash text (lowercase 64-character SHA-256 hex supplied by the client)

Payload shape; every section and array may be omitted. Upsert entries are complete
business rows. IDs are UUIDs. Server-owned organization/version/audit fields are ignored.
{
  "members": {
    "upsert": [{"id","authUserId?","employeeCode?","initials","name","role","department","avatarTone","skills":[],"location","capacity","isActive"}],
    "archiveIds": ["uuid"]
  },
  "projects": {
    "upsert": [{"id","code","name","summary","status","tone","ownerPersonId?","startDate","endDate","nextMilestone","nextMilestoneDate?","progress","demand"}],
    "archiveIds": ["uuid"]
  },
  "assignments": {
    "upsert": [{"id","personId","projectId","staffingNeedId?","startDate","endDate","allocation","status","label?","clientRequestId?"}],
    "cancelIds": ["uuid"]
  },
  "needs": {
    "upsert": [{"id","projectId","role","skills":[],"startDate","endDate","allocation","status","draftPersonId?"}],
    "cancelIds": ["uuid"]
  }
}

Returns: {"organizationId","revision","requestId","replayed","savedAt"}.
The revision compare-and-swap, every row change, audit entries, and idempotency record
commit in one database transaction. SQLSTATE 40001 means the client must reload and merge;
it must not blindly replay a stale diff with a new expected revision.
For assignments, an omitted staffingNeedId preserves an existing link (or allows
legacy matching for an unlinked row); an explicit JSON null or empty string
detaches it. Active assignments may not reference inactive people or archived
projects, active staffing needs may not reference archived projects, and an
active project cannot retain an inactive owner member.
All active assignment/need periods must stay within project dates. Open or
cancelled needs must have neither a draft person nor an active linked assignment;
planned/filled needs require exactly one active linked assignment for their
qualified draft person, covering the need period and allocation. Planned needs
link to draft assignments; filled needs link to confirmed assignments.
$comment$;

-- Explicit privileges. New Supabase projects no longer expose SQL-created
-- tables automatically; these grants intentionally expose only the
-- organization revision row needed by Postgres Changes. `app` must remain
-- absent from the Data API exposed-schemas list.
revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all sequences in schema app from public, anon, authenticated, service_role;
grant select on app.organizations to authenticated;

revoke all on function public.get_my_context() from public, anon, authenticated;
revoke all on function public.create_organization(text, uuid) from public, anon, authenticated;
revoke all on function public.get_workspace(uuid) from public, anon, authenticated;
revoke all on function public.save_workspace(uuid, bigint, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.invite_member(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_organization_invitations(uuid) from public, anon, authenticated;
revoke all on function public.revoke_organization_invitation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_invitation(uuid) from public, anon, authenticated;
revoke all on function public.list_organization_members(uuid) from public, anon, authenticated;
revoke all on function public.manage_organization_member(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.list_audit_events(uuid, integer, bigint) from public, anon, authenticated;

grant execute on function public.get_my_context() to authenticated;
grant execute on function public.create_organization(text, uuid) to authenticated;
grant execute on function public.get_workspace(uuid) to authenticated;
grant execute on function public.save_workspace(uuid, bigint, uuid, jsonb, text) to authenticated;
grant execute on function public.invite_member(uuid, text, text) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid, uuid, uuid) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.manage_organization_member(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.list_audit_events(uuid, integer, bigint) to authenticated;

-- Realtime publishes only the organization revision signal. Clients refetch a
-- complete get_workspace() snapshot after observing a newer revision.
alter publication supabase_realtime add table app.organizations;

commit;
