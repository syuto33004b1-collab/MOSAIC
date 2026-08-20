begin;

create table app.favorites (
  organization_id uuid not null references app.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('member', 'project')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, kind, target_id)
);

create index favorites_user_created_idx
  on app.favorites (organization_id, user_id, created_at, target_id);

alter table app.favorites enable row level security;
alter table app.favorites force row level security;

revoke all on table app.favorites from public, anon, authenticated, service_role;

create or replace function public.list_favorites(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'p_organization_id is required';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'kind', favorite.kind,
      'targetId', favorite.target_id
    ) order by favorite.created_at, favorite.target_id
  ), '[]'::jsonb)
  into v_result
  from app.favorites as favorite
  where favorite.organization_id = p_organization_id
    and favorite.user_id = v_user_id
    and (
      (
        favorite.kind = 'member'
        and exists (
          select 1
          from app.people as person
          where person.organization_id = favorite.organization_id
            and person.id = favorite.target_id
            and person.is_active
        )
      )
      or (
        favorite.kind = 'project'
        and exists (
          select 1
          from app.projects as project
          where project.organization_id = favorite.organization_id
            and project.id = favorite.target_id
            and project.archived_at is null
        )
      )
    );

  return jsonb_build_object('favorites', v_result);
end;
$function$;

create or replace function public.set_favorite(
  p_organization_id uuid,
  p_kind text,
  p_target_id uuid,
  p_favorite boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_organization_id is null or p_target_id is null or p_favorite is null then
    raise exception using errcode = '22023', message = 'organization, target, and favorite flag are required';
  end if;
  if v_kind not in ('member', 'project') then
    raise exception using errcode = '22023', message = 'kind must be member or project';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'not authorized';
  end if;

  if p_favorite then
    if v_kind = 'member' then
      if not exists (
        select 1
        from app.people as person
        where person.organization_id = p_organization_id
          and person.id = p_target_id
          and person.is_active
      ) then
        raise exception using errcode = 'P0002', message = 'favorite member not found';
      end if;
    elsif not exists (
      select 1
      from app.projects as project
      where project.organization_id = p_organization_id
        and project.id = p_target_id
        and project.archived_at is null
    ) then
      raise exception using errcode = 'P0002', message = 'favorite project not found';
    end if;

    select count(*)
    into v_count
    from app.favorites as favorite
    where favorite.organization_id = p_organization_id
      and favorite.user_id = v_user_id;

    if v_count >= 100 and not exists (
      select 1
      from app.favorites as favorite
      where favorite.organization_id = p_organization_id
        and favorite.user_id = v_user_id
        and favorite.kind = v_kind
        and favorite.target_id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'favorite limit is 100';
    end if;

    insert into app.favorites (organization_id, user_id, kind, target_id)
    values (p_organization_id, v_user_id, v_kind, p_target_id)
    on conflict do nothing;
  else
    delete from app.favorites as favorite
    where favorite.organization_id = p_organization_id
      and favorite.user_id = v_user_id
      and favorite.kind = v_kind
      and favorite.target_id = p_target_id;
  end if;

  return public.list_favorites(p_organization_id);
end;
$function$;

comment on function public.list_favorites(uuid) is $comment$
Arguments: p_organization_id uuid.
Returns: {"favorites":[{"kind":"member"|"project","targetId":"<uuid>"}]}.
Lists only the caller's favorites that still point at an active member or unarchived project.
Authorization is an active organization membership. Does not change workspace revision.
$comment$;

comment on function public.set_favorite(uuid, text, uuid, boolean) is $comment$
Arguments: p_organization_id uuid, p_kind text (member|project), p_target_id uuid, p_favorite boolean.
Returns the same shape as list_favorites after inserting or deleting the caller's row.
Unknown or inactive targets raise P0002. The per-user cap is 100. Authorization is an active organization membership.
$comment$;

revoke all on function public.list_favorites(uuid) from public, anon, authenticated;
grant execute on function public.list_favorites(uuid) to authenticated;
revoke all on function public.set_favorite(uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_favorite(uuid, text, uuid, boolean) to authenticated;

commit;
