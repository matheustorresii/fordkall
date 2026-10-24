-- Attendance is not a browser timer: keep server snapshots, connection-scoped heartbeats,
-- and personal history separate. None of these operations can change room visibility.
alter table public.livekit_token_issuances
  add column room_seen_at timestamptz,
  add column room_left_at timestamptz;
create index livekit_personal_rooms_idx on public.livekit_token_issuances(user_id, issued_at desc)
  where connection_succeeded is true;

create table public.call_directory_sync (
  backend_id text primary key references public.livekit_backends(id),
  checked_at timestamptz,
  attempted_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  failed boolean not null default false
);
create table public.call_room_live_snapshots (
  backend_id text not null references public.livekit_backends(id),
  room_code text not null references public.call_rooms(code) on delete cascade,
  user_ids uuid[] not null,
  checked_at timestamptz not null default now(),
  primary key(backend_id,room_code)
);
alter table public.call_directory_sync enable row level security;
alter table public.call_room_live_snapshots enable row level security;
revoke all on public.call_directory_sync, public.call_room_live_snapshots from public,anon,authenticated;
grant all on public.call_directory_sync,public.call_room_live_snapshots to service_role;

create function public.claim_call_directory_refresh(p_backend_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare claimed uuid := gen_random_uuid();
begin
  insert into public.call_directory_sync(backend_id) values(p_backend_id) on conflict do nothing;
  update public.call_directory_sync set lease_token=claimed,lease_until=now()+interval '25 seconds',attempted_at=now()
    where backend_id=p_backend_id
      and (lease_until is null or lease_until<now())
      and (attempted_at is null or attempted_at<now()-interval '20 seconds');
  if found then return claimed; end if;
  return null;
end; $$;

create function public.finish_call_directory_refresh(p_backend_id text,p_lease_token uuid,p_rooms jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare inspected_at timestamptz;
begin
  -- Fence delayed workers: an expired request cannot overwrite a newer snapshot.
  select attempted_at into inspected_at from public.call_directory_sync where backend_id=p_backend_id and lease_token=p_lease_token for update;
  if not found then return false; end if;
  if p_rooms is not null then
    delete from public.call_room_live_snapshots where backend_id=p_backend_id;
    insert into public.call_room_live_snapshots(backend_id,room_code,user_ids,checked_at)
      select p_backend_id,x.code,x.user_ids,inspected_at from jsonb_to_recordset(p_rooms) as x(code text,user_ids uuid[])
      join public.call_rooms r on r.code=x.code and not r.is_private
      where cardinality(x.user_ids)>0;
    update public.call_directory_sync set checked_at=inspected_at,failed=false,lease_until=null,lease_token=null where backend_id=p_backend_id;
  else
    -- An API failure is not evidence that everybody left. Preserve the previous snapshot.
    update public.call_directory_sync set failed=true,lease_until=null,lease_token=null where backend_id=p_backend_id;
  end if;
  return true;
end; $$;
revoke all on function public.claim_call_directory_refresh(text),public.finish_call_directory_refresh(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_call_directory_refresh(text),public.finish_call_directory_refresh(text,uuid,jsonb) to service_role;

drop function public.touch_call_room(text,boolean);
create function public.touch_call_room(p_room_code text,p_leave boolean default false,p_session_id bigint default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  if p_session_id is null then
    -- Keep old released apps working; legacy heartbeats cannot close a new scoped connection.
    update public.call_room_members set seen_at=case when p_leave then '1970-01-01'::timestamptz else now() end
      where room_code=p_room_code and user_id=auth.uid();
    return found;
  end if;
  update public.livekit_token_issuances set
    room_seen_at=case when p_leave then room_seen_at else now() end,
    room_left_at=case when p_leave then now() else room_left_at end
    where id=p_session_id and room_name=p_room_code and user_id=auth.uid()
      and (p_leave or connection_succeeded is true) and room_left_at is null;
  if not found then return false; end if;
  -- Closed session IDs never reopen. A late leave from session A cannot remove session B.
  if not p_leave then
    insert into public.call_room_members(room_code,user_id,seen_at) values(p_room_code,auth.uid(),now())
      on conflict(room_code,user_id) do update set seen_at=excluded.seen_at;
  elsif not exists(select 1 from public.livekit_token_issuances i where i.room_name=p_room_code and i.user_id=auth.uid()
    and i.connection_succeeded is true and i.room_left_at is null and i.room_seen_at>now()-interval '90 seconds') then
    update public.call_room_members set seen_at='1970-01-01' where room_code=p_room_code and user_id=auth.uid();
  end if;
  return true;
end; $$;
revoke all on function public.touch_call_room(text,boolean,bigint) from public,anon;
grant execute on function public.touch_call_room(text,boolean,bigint) to authenticated;

create or replace function public.list_public_call_rooms()
returns table(code text,user_ids uuid[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  return query
  with attendance as (
    select s.room_code,unnest(s.user_ids) as user_id from public.call_room_live_snapshots s
      where s.checked_at>now()-interval '10 minutes'
    union
    select m.room_code,m.user_id from public.call_room_members m
      where m.seen_at>now()-interval '90 seconds'
      and not exists(select 1 from public.livekit_room_routes route join public.call_directory_sync sync on sync.backend_id=route.backend_id
        where route.room_name=m.room_code and sync.checked_at>=m.seen_at)
  )
  select r.code,array_agg(distinct a.user_id order by a.user_id) from public.call_rooms r
    join attendance a on a.room_code=r.code join public.profiles p on p.id=a.user_id and p.status='active'
    where not r.is_private group by r.code order by count(distinct a.user_id) desc,r.code limit 100;
end; $$;

create function public.list_my_call_rooms()
returns table(code text,is_private boolean,last_joined_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  -- History belongs to auth.uid(), never an arbitrary user ID supplied by the browser.
  return query select r.code,r.is_private,max(i.issued_at) from public.livekit_token_issuances i
    join public.call_rooms r on r.code=i.room_name
    where i.user_id=auth.uid() and i.connection_succeeded is true
    group by r.code,r.is_private order by max(i.issued_at) desc limit 30;
end; $$;
revoke all on function public.list_my_call_rooms() from public,anon;
grant execute on function public.list_my_call_rooms() to authenticated;
