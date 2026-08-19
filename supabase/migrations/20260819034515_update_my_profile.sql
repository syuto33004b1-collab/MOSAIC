begin;

create or replace function public.update_my_profile(p_display_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_display_name, '')), 120);
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if char_length(v_name) < 1 then
    raise exception using errcode = '22023', message = 'a display name is required';
  end if;

  update app.profiles as profile
  set display_name = v_name
  where profile.id = v_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  return jsonb_build_object('displayName', v_name);
end;
$function$;

comment on function public.update_my_profile(text) is $comment$
Arguments: p_display_name text (1-120 characters after trim).
Returns: {"displayName": "..."}.
Updates only the caller's app.profiles row. Authorization is auth.uid().
$comment$;

revoke all on function public.update_my_profile(text) from public, anon, authenticated;
grant execute on function public.update_my_profile(text) to authenticated;

commit;
