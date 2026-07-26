-- Market Radar V85 normalized entity store.
-- Run this file once in the Supabase SQL Editor before enabling V85 cloud sync.

create table if not exists radar_entities (
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  entity_id text not null,
  data jsonb not null default '{}'::jsonb,
  source_version integer not null default 1,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, bucket, entity_id),
  constraint radar_entities_bucket_check check (
    bucket in (
      'stock',
      'history',
      'plan',
      'trade_log',
      'report',
      'snapshot',
      'setting',
      'dashboard',
      'tombstone'
    )
  )
);

create index if not exists radar_entities_owner_bucket_updated_idx
  on radar_entities (owner_id, bucket, updated_at desc);

create index if not exists radar_entities_owner_deleted_idx
  on radar_entities (owner_id, deleted_at)
  where deleted_at is not null;

create table if not exists radar_migrations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  migration_name text not null,
  checksum text not null,
  details jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  primary key (owner_id, migration_name)
);

create or replace function radar_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists radar_entities_set_updated_at on radar_entities;
create trigger radar_entities_set_updated_at
before update on radar_entities
for each row execute function radar_set_updated_at();

alter table radar_entities enable row level security;
alter table radar_migrations enable row level security;

drop policy if exists "radar entity owner read" on radar_entities;
create policy "radar entity owner read"
on radar_entities for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "radar entity owner insert" on radar_entities;
create policy "radar entity owner insert"
on radar_entities for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "radar entity owner update" on radar_entities;
create policy "radar entity owner update"
on radar_entities for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "radar entity owner delete" on radar_entities;
create policy "radar entity owner delete"
on radar_entities for delete
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "radar migration owner read" on radar_migrations;
create policy "radar migration owner read"
on radar_migrations for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "radar migration owner insert" on radar_migrations;
create policy "radar migration owner insert"
on radar_migrations for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "radar migration owner update" on radar_migrations;
create policy "radar migration owner update"
on radar_migrations for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- The old app_state table remains untouched as a rollback source.
-- After V85 migration is verified, remove its anonymous write policies:
--
-- drop policy if exists "personal app state insert" on app_state;
-- drop policy if exists "personal app state update" on app_state;
