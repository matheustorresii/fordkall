create table if not exists public.livekit_backends (
  id text primary key,
  label text not null,
  rotation_order integer not null unique,
  enabled boolean not null default true,
  consecutive_failures integer not null default 0,
  cooldown_until timestamptz,
  last_selected_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint livekit_backends_id_format check (id ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  constraint livekit_backends_failures_nonnegative check (consecutive_failures >= 0)
);

create table if not exists public.livekit_room_routes (
  room_name text primary key,
  backend_id text not null references public.livekit_backends(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '12 hours')
);

create index if not exists livekit_room_routes_backend_idx
  on public.livekit_room_routes(backend_id, expires_at desc);
create index if not exists livekit_room_routes_expiry_idx
  on public.livekit_room_routes(expires_at);

alter table public.livekit_token_issuances
  add column if not exists backend_id text references public.livekit_backends(id) on delete restrict,
  add column if not exists connection_succeeded boolean,
  add column if not exists reported_at timestamptz;

alter table public.call_events
  add column if not exists backend_id text references public.livekit_backends(id) on delete set null;

insert into public.livekit_backends (id, label, rotation_order)
values
  ('primary', 'Principal', 1),
  ('reserve-2', 'Reserva 2', 2),
  ('reserve-3', 'Reserva 3', 3)
on conflict (id) do update
set label = excluded.label,
    rotation_order = excluded.rotation_order;

drop trigger if exists livekit_backends_set_updated_at on public.livekit_backends;
create trigger livekit_backends_set_updated_at
before update on public.livekit_backends
for each row execute function public.set_updated_at();

create or replace function public.assign_livekit_backend(
  p_room_name text,
  p_available_backend_ids text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_room text := upper(trim(p_room_name));
  existing_route public.livekit_room_routes%rowtype;
  selected_backend_id text;
begin
  if normalized_room = '' or coalesce(array_length(p_available_backend_ids, 1), 0) = 0 then
    raise exception 'LIVEKIT_POOL_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fordkall-room:' || normalized_room, 0)
  );

  delete from public.livekit_room_routes
  where room_name = normalized_room
    and expires_at <= now();

  select route.* into existing_route
  from public.livekit_room_routes as route
  join public.livekit_backends as backend on backend.id = route.backend_id
  where route.room_name = normalized_room
    and backend.enabled
    and backend.id = any(p_available_backend_ids)
    and (
      route.confirmed_at is not null
      or backend.cooldown_until is null
      or backend.cooldown_until <= now()
    )
  limit 1;

  if found then
    update public.livekit_room_routes
    set last_used_at = now(),
        expires_at = now() + interval '12 hours'
    where room_name = normalized_room;
    return existing_route.backend_id;
  end if;

  delete from public.livekit_room_routes where room_name = normalized_room;

  select backend.id into selected_backend_id
  from public.livekit_backends as backend
  where backend.enabled
    and backend.id = any(p_available_backend_ids)
    and (backend.cooldown_until is null or backend.cooldown_until <= now())
  order by backend.last_selected_at asc nulls first, backend.rotation_order asc
  for update
  limit 1;

  if selected_backend_id is null then
    raise exception 'LIVEKIT_POOL_UNAVAILABLE';
  end if;

  update public.livekit_backends
  set last_selected_at = now()
  where id = selected_backend_id;

  insert into public.livekit_room_routes (
    room_name,
    backend_id,
    assigned_at,
    last_used_at,
    expires_at
  ) values (
    normalized_room,
    selected_backend_id,
    now(),
    now(),
    now() + interval '12 hours'
  );

  return selected_backend_id;
end;
$$;

create or replace function public.report_livekit_backend_connection(
  p_room_name text,
  p_backend_id text,
  p_succeeded boolean,
  p_room_has_participants boolean default false,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_room text := upper(trim(p_room_name));
  next_failure_count integer;
  route_removed boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fordkall-backend:' || p_backend_id, 0)
  );

  if p_succeeded then
    update public.livekit_backends
    set consecutive_failures = 0,
        cooldown_until = null,
        last_success_at = now(),
        last_error = null
    where id = p_backend_id;

    update public.livekit_room_routes
    set confirmed_at = coalesce(confirmed_at, now()),
        last_used_at = now(),
        expires_at = now() + interval '12 hours'
    where room_name = normalized_room
      and backend_id = p_backend_id;

    return false;
  end if;

  select consecutive_failures + 1 into next_failure_count
  from public.livekit_backends
  where id = p_backend_id
  for update;

  if next_failure_count is null then
    return false;
  end if;

  update public.livekit_backends
  set consecutive_failures = next_failure_count,
      last_failure_at = now(),
      last_error = left(coalesce(p_error, 'CONNECTION_FAILED'), 240),
      cooldown_until = case
        when next_failure_count >= 2 then now() + interval '5 minutes'
        else cooldown_until
      end
  where id = p_backend_id;

  if not p_room_has_participants then
    delete from public.livekit_room_routes
    where room_name = normalized_room
      and backend_id = p_backend_id;
    route_removed := found;
  end if;

  return route_removed;
end;
$$;

alter table public.livekit_backends enable row level security;
alter table public.livekit_room_routes enable row level security;

revoke all on public.livekit_backends from public, anon, authenticated;
revoke all on public.livekit_room_routes from public, anon, authenticated;
revoke all on function public.assign_livekit_backend(text, text[]) from public, anon, authenticated;
revoke all on function public.report_livekit_backend_connection(text, text, boolean, boolean, text) from public, anon, authenticated;

grant select, insert, update, delete on public.livekit_backends to service_role;
grant select, insert, update, delete on public.livekit_room_routes to service_role;
grant execute on function public.assign_livekit_backend(text, text[]) to service_role;
grant execute on function public.report_livekit_backend_connection(text, text, boolean, boolean, text) to service_role;
