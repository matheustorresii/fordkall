-- Invitations are private signaling, not public Presence. Never broadcast private room codes.
create table public.social_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  do_not_disturb boolean not null default false,
  favorite_users uuid[] not null default '{}',
  favorite_rooms text[] not null default '{}',
  check(cardinality(favorite_users)<=30 and cardinality(favorite_rooms)<=30)
);
alter table public.social_preferences enable row level security;
revoke all on public.social_preferences from public,anon,authenticated;
grant select,insert,update on public.social_preferences to authenticated;
create policy "Own social preferences" on public.social_preferences for all to authenticated
using(user_id=auth.uid() and public.is_active_social_user())
with check(user_id=auth.uid() and public.is_active_social_user());

create table public.direct_calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  room_code text not null references public.call_rooms(code) on delete cascade,
  status text not null default 'ringing' check(status in ('ringing','accepted','declined','cancelled','missed','busy','ended')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '45 seconds',
  answered_at timestamptz,
  ended_at timestamptz,
  check(caller_id<>recipient_id)
);
create index direct_calls_caller_recent on public.direct_calls(caller_id,created_at desc);
create index direct_calls_recipient_recent on public.direct_calls(recipient_id,created_at desc);
alter table public.direct_calls enable row level security;
revoke all on public.direct_calls from public,anon,authenticated;
grant select on public.direct_calls to authenticated;
create policy "Call participants only" on public.direct_calls for select to authenticated
using(auth.uid() in(caller_id,recipient_id) and public.is_active_social_user());
-- Only the participants receive these rows; clients cannot manufacture a call or change its caller.
alter publication supabase_realtime add table public.direct_calls;

create function public.start_direct_call(p_recipient uuid,p_room_code text default null)
returns public.direct_calls language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); call public.direct_calls; room_code_value text;
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  if p_recipient=me or not exists(select 1 from public.profiles where id=p_recipient and status='active') then raise exception 'CALL_UNAVAILABLE'; end if;
  -- Stable lock ordering prevents simultaneous A->B / B->A and third-party calls racing.
  perform pg_advisory_xact_lock(hashtextextended(least(me::text,p_recipient::text),41));
  perform pg_advisory_xact_lock(hashtextextended(greatest(me::text,p_recipient::text),41));
  update public.direct_calls set status='missed',ended_at=now()
    where status='ringing' and expires_at<=now() and (me in(caller_id,recipient_id) or p_recipient in(caller_id,recipient_id));
  if (select count(*) from public.direct_calls where caller_id=me and created_at>now()-interval '5 minutes')>=5 then raise exception 'CALL_RATE_LIMIT'; end if;
  if exists(select 1 from public.social_preferences where user_id=p_recipient and do_not_disturb) then raise exception 'CALL_DO_NOT_DISTURB'; end if;
  if exists(select 1 from public.direct_calls where status='ringing' and (me in(caller_id,recipient_id) or p_recipient in(caller_id,recipient_id))) then raise exception 'CALL_BUSY'; end if;
  if exists(select 1 from public.livekit_token_issuances where user_id=p_recipient and connection_succeeded is true and room_left_at is null and room_seen_at>now()-interval '90 seconds') then raise exception 'CALL_BUSY'; end if;
  if nullif(trim(p_room_code),'') is not null then
    if not exists(select 1 from public.livekit_token_issuances where user_id=me and room_name=p_room_code and connection_succeeded is true and room_left_at is null and room_seen_at>now()-interval '90 seconds') then raise exception 'CALL_ROOM_REQUIRED'; end if;
    room_code_value:=p_room_code;
  else
    room_code_value:='FK-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
    insert into public.call_rooms(code,is_private,created_by) values(room_code_value,true,me);
  end if;
  insert into public.direct_calls(caller_id,recipient_id,room_code) values(me,p_recipient,room_code_value) returning * into call;
  return call;
end; $$;

create function public.respond_direct_call(p_call_id uuid,p_action text)
returns public.direct_calls language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); call public.direct_calls;
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  select * into call from public.direct_calls where id=p_call_id and me in(caller_id,recipient_id) for update;
  if not found then raise exception 'CALL_NOT_FOUND'; end if;
  if call.status='ringing' and call.expires_at<=now() then
    update public.direct_calls set status='missed',ended_at=now() where id=call.id returning * into call;
    return call;
  end if;
  if p_action='accept' and call.status<>'ringing' then raise exception 'CALL_ALREADY_ANSWERED'; end if;
  if p_action='accept' and call.recipient_id=me and call.status='ringing' then
    -- Acceptance on one device wins; a late second device cannot reconnect the call.
    if exists(select 1 from public.livekit_token_issuances where user_id=me and room_name<>call.room_code and connection_succeeded is true and room_left_at is null and room_seen_at>now()-interval '90 seconds') then
      update public.direct_calls set status='busy',ended_at=now() where id=call.id returning * into call;
    else
      update public.direct_calls set status='accepted',answered_at=now() where id=call.id returning * into call;
    end if;
  elsif p_action='decline' and call.recipient_id=me and call.status='ringing' then
    update public.direct_calls set status='declined',ended_at=now() where id=call.id returning * into call;
  elsif p_action='cancel' and call.caller_id=me and call.status='ringing' then
    update public.direct_calls set status='cancelled',ended_at=now() where id=call.id returning * into call;
  elsif p_action='end' and call.status='accepted' then
    update public.direct_calls set status='ended',ended_at=now() where id=call.id returning * into call;
  end if;
  return call;
end; $$;

create function public.list_my_direct_calls()
returns setof public.direct_calls language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_social_user() then raise exception 'ACTIVE_ACCOUNT_REQUIRED'; end if;
  update public.direct_calls set status='missed',ended_at=now() where status='ringing' and expires_at<=now() and auth.uid() in(caller_id,recipient_id);
  return query select * from public.direct_calls where auth.uid() in(caller_id,recipient_id) and created_at>now()-interval '7 days' order by created_at desc limit 30;
end; $$;
revoke all on function public.start_direct_call(uuid,text),public.respond_direct_call(uuid,text),public.list_my_direct_calls() from public,anon;
grant execute on function public.start_direct_call(uuid,text),public.respond_direct_call(uuid,text),public.list_my_direct_calls() to authenticated;
