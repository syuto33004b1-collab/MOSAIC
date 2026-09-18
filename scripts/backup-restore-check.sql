-- Restore fingerprint for MOSAIC logical backups (#416).
--
-- What this is
--   One JSON object a restored database must match against the source.
--   Counts every base table in `app` (and `private` if it ever gains one),
--   counts `auth.users` when that relation exists, walks every foreign key
--   that starts in `app`/`private`, and adds a few aggregates the board
--   actually uses. New tables are picked up from the catalog; a hardcoded
--   list would go stale the next time a migration lands.
--
-- What this is not
--   Not a backup. Not a proof that GRANT, publications, or Edge Function
--   secrets came back. Those are out of this query on purpose: the CLI
--   default dump strips several of them, and claiming they matched would
--   be a lie. The roundtrip script records that other range separately.
--
-- How to run
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -f scripts/backup-restore-check.sql
--
-- Output is one JSON object on stdout. Compare source vs restored with `diff`.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

create temporary table backup_check_counts (
  schema_name text not null,
  table_name text not null,
  n bigint not null,
  primary key (schema_name, table_name)
);

create temporary table backup_check_orphans (
  constraint_name text not null,
  src text not null,
  dst text not null,
  orphan_count bigint not null
);

do $count$
declare
  rel record;
  n bigint;
begin
  for rel in
    select ns.nspname, cls.relname
    from pg_class as cls
    join pg_namespace as ns on ns.oid = cls.relnamespace
    where cls.relkind = 'r'
      and ns.nspname in ('app', 'private', 'auth')
    order by ns.nspname, cls.relname
  loop
    execute format('select count(*) from %I.%I', rel.nspname, rel.relname) into n;
    insert into backup_check_counts values (rel.nspname, rel.relname, n);
  end loop;
end
$count$;

do $orphans$
declare
  fk record;
  src_cols text;
  dst_cols text;
  not_null_pred text;
  orphan_count bigint;
begin
  for fk in
    select
      con.conname,
      src_ns.nspname as src_schema,
      src_cls.relname as src_table,
      dst_ns.nspname as dst_schema,
      dst_cls.relname as dst_table,
      con.conrelid,
      con.confrelid,
      con.conkey,
      con.confkey
    from pg_constraint as con
    join pg_class as src_cls on src_cls.oid = con.conrelid
    join pg_namespace as src_ns on src_ns.oid = src_cls.relnamespace
    join pg_class as dst_cls on dst_cls.oid = con.confrelid
    join pg_namespace as dst_ns on dst_ns.oid = dst_cls.relnamespace
    where con.contype = 'f'
      and src_ns.nspname in ('app', 'private')
    order by src_ns.nspname, src_cls.relname, con.conname
  loop
    select
      string_agg(format('src.%I', att.attname), ', ' order by ord.ordinality),
      string_agg(format('src.%I is not null', att.attname), ' and ' order by ord.ordinality)
    into src_cols, not_null_pred
    from unnest(fk.conkey) with ordinality as ord(attnum, ordinality)
    join pg_attribute as att
      on att.attrelid = fk.conrelid
     and att.attnum = ord.attnum;

    select string_agg(format('dst.%I', att.attname), ', ' order by ord.ordinality)
    into dst_cols
    from unnest(fk.confkey) with ordinality as ord(attnum, ordinality)
    join pg_attribute as att
      on att.attrelid = fk.confrelid
     and att.attnum = ord.attnum;

    execute format(
      'select count(*) from %I.%I as src
        where (%s)
          and not exists (
            select 1 from %I.%I as dst
            where (%s) is not distinct from (%s)
          )',
      fk.src_schema,
      fk.src_table,
      not_null_pred,
      fk.dst_schema,
      fk.dst_table,
      src_cols,
      dst_cols
    ) into orphan_count;

    insert into backup_check_orphans
    values (
      fk.conname,
      format('%s.%s', fk.src_schema, fk.src_table),
      format('%s.%s', fk.dst_schema, fk.dst_table),
      orphan_count
    );
  end loop;
end
$orphans$;

select jsonb_pretty(
  jsonb_build_object(
    'table_counts',
      coalesce((
        select jsonb_object_agg(schema_name || '.' || table_name, n order by schema_name, table_name)
        from backup_check_counts
      ), '{}'::jsonb),
    'fk_orphans',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'constraint', constraint_name,
            'from', src,
            'to', dst,
            'orphans', orphan_count
          )
          order by src, constraint_name
        )
        from backup_check_orphans
        where orphan_count > 0
      ), '[]'::jsonb),
    'fk_orphan_total',
      (select coalesce(sum(orphan_count), 0) from backup_check_orphans),
    'fk_constraint_count',
      (select count(*) from backup_check_orphans),
    'aggregates',
      jsonb_strip_nulls(jsonb_build_object(
        'assignment_allocation_sum',
          case when to_regclass('app.assignments') is null then null
               else (select coalesce(sum(allocation_percent), 0) from app.assignments where status <> 'cancelled')
          end,
        'project_min_start',
          case when to_regclass('app.projects') is null then null
               else (select min(start_date) from app.projects)
          end,
        'project_max_end',
          case when to_regclass('app.projects') is null then null
               else (select max(end_date) from app.projects)
          end,
        'active_memberships',
          case when to_regclass('app.organization_memberships') is null then null
               else (select count(*) from app.organization_memberships where status = 'active')
          end,
        'memberships_by_role',
          case when to_regclass('app.organization_memberships') is null then null
               else (
                 select coalesce(jsonb_object_agg(role, n order by role), '{}'::jsonb)
                 from (
                   select role, count(*) as n
                   from app.organization_memberships
                   group by role
                 ) as roles
               )
          end,
        'auth_users',
          case when to_regclass('auth.users') is null then null
               else (select count(*) from auth.users)
          end
      ))
  )
);
