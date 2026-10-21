-- Room codes are capabilities: private rooms can be joined with the code, never enumerated.
create table public.call_rooms (
  code text primary key check (char_length(code) between 1 and 64),
  is_private boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.call_room_members (
  room_code text not null references public.call_rooms(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (room_code,user_id)
);
alter table public.call_rooms enable row level security;
alter table public.call_room_members enable row level security;
revoke all on public.call_rooms,public.call_room_members from anon,authenticated;
create index call_room_members_seen_idx on public.call_room_members(seen_at);

create function public.touch_call_room(p_room_code text,p_leave boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  -- Membership is issued exclusively by the token server. This RPC cannot create one.
  if p_leave then
    update public.call_room_members set seen_at='1970-01-01' where room_code=p_room_code and user_id=auth.uid();
  else
    update public.call_room_members set seen_at=now() where room_code=p_room_code and user_id=auth.uid();
  end if;
end; $$;
create function public.list_public_call_rooms()
returns table(code text, user_ids uuid[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  return query select r.code,array_agg(m.user_id order by m.user_id)
  from public.call_rooms r join public.call_room_members m on m.room_code=r.code
  join public.profiles p on p.id=m.user_id and p.status='active'
  where not r.is_private and m.seen_at>now()-interval '90 seconds'
  group by r.code limit 100;
end; $$;
revoke all on function public.touch_call_room(text,boolean),public.list_public_call_rooms() from public,anon;
grant execute on function public.touch_call_room(text,boolean),public.list_public_call_rooms() to authenticated;

alter table public.profiles add column decoration_id text not null default 'none';
alter table public.profiles add column call_background_id text not null default 'none';
alter table public.profiles add constraint profiles_decoration_id check (decoration_id in ('none','botanical','orbit','frangoelho','frangoelho-arcade','frangoelho-cloud','avatar-air','avatar-water','avatar-fire','avatar-earth','barbie-mermaid','barbie-coral','barbie-wave','sakura','lunar','ember','ocean','arcade','aurora','desert','noir'));
alter table public.profiles add constraint profiles_call_background_id check (call_background_id in ('none','dusk','grove','frangoelho','frangoelho-arcade','frangoelho-cloud','avatar-air','avatar-water','avatar-fire','avatar-earth','barbie-mermaid','barbie-coral','barbie-wave','sakura','lunar','ember','ocean','arcade','aurora','desert','noir'));
grant update(decoration_id,call_background_id) on public.profiles to authenticated;

-- Separate RPC keeps legacy clients' table return signatures stable.
create function public.get_profile_cosmetics(p_user_ids uuid[])
returns table(id uuid,decoration_id text,call_background_id text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  if coalesce(cardinality(p_user_ids),0)>30 then raise exception 'SOCIAL_PROFILE_BATCH_LIMIT'; end if;
  return query select p.id,p.decoration_id,p.call_background_id from public.profiles p where p.id=any(p_user_ids) and p.status='active';
end; $$;
revoke all on function public.get_profile_cosmetics(uuid[]) from public,anon;
grant execute on function public.get_profile_cosmetics(uuid[]) to authenticated;
