-- Server-side private checkpoints. Only the leased distributor can retrieve the deck.
-- This is recovery for trusted friends, not a server-authoritative anti-cheat engine.
create table public.room_game_checkpoints (
  room_code text not null references public.call_rooms(code) on delete cascade,
  topic text not null check(topic ~ '^ford-kall\.[a-z-]+\.v[0-9]+$' and length(topic)<96),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  owner_session uuid not null,
  epoch bigint not null default 1,
  lease_until timestamptz not null default now()+interval '20 seconds',
  heartbeat_at timestamptz not null default now(),
  revision bigint not null default -1,
  public_state jsonb,
  private_state jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  primary key(room_code,topic),
  check(octet_length(public_state::text)<=65536 and octet_length(private_state::text)<=524288)
);
alter table public.room_game_checkpoints enable row level security;
revoke all on public.room_game_checkpoints from public,anon,authenticated;
grant all on public.room_game_checkpoints to service_role;

create function public.require_game_room_member(p_room text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_social_user() or not exists(
    select 1 from public.livekit_token_issuances i where i.user_id=auth.uid() and i.room_name=p_room
      and i.connection_succeeded is true and i.room_left_at is null
      and i.issued_at>now()-interval '24 hours'
  ) then raise exception 'GAME_ROOM_REQUIRED'; end if;
end; $$;
revoke all on function public.require_game_room_member(text) from public,anon,authenticated;

create function public.list_game_checkpoints(p_room text,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.require_game_room_member(p_room);
  select coalesce(jsonb_agg(jsonb_build_object(
    'topic',c.topic,'owner',c.owner_id,'epoch',c.epoch,'owns',c.owner_id=auth.uid() and c.owner_session=p_session,
    'leaseUntil',c.lease_until,'heartbeatAt',c.heartbeat_at,'revision',c.revision,'state',c.public_state,'savedAt',c.updated_at,
    'ownPrivate',c.private_state->'secrets'->auth.uid()::text,
    'payload',case when c.owner_id=auth.uid() and c.owner_session=p_session then c.private_state else null end
  )),'[]') into result from public.room_game_checkpoints c where c.room_code=p_room and c.expires_at>now();
  return result;
end; $$;

create function public.claim_game_checkpoint(p_room text,p_topic text,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.room_game_checkpoints; previous_heartbeat timestamptz; acquired boolean:=false;
begin
  perform public.require_game_room_member(p_room);
  if p_topic not in('ford-kall.poker.v2','ford-kall.coup.v2','ford-kall.truco-mineiro.v3','ford-kall.codenames.v3','ford-kall.ito.v4','ford-kall.the-mind.v2','ford-kall.exploding-kiwi.v2','ford-kall.gartic.v1','ford-kall.impostor.v1','ford-kall.game-participation.v1') then raise exception 'INVALID_GAME_TOPIC'; end if;
  insert into public.room_game_checkpoints(room_code,topic,owner_id,owner_session) values(p_room,p_topic,auth.uid(),p_session) on conflict do nothing;
  select * into c from public.room_game_checkpoints where room_code=p_room and topic=p_topic for update;
  previous_heartbeat:=c.heartbeat_at;
  if c.owner_id=auth.uid() and c.owner_session=p_session or c.lease_until<=now() then
    acquired:=true;
    if c.owner_id<>auth.uid() or c.owner_session<>p_session then c.epoch:=c.epoch+1; end if;
    if c.expires_at<=now() then c.public_state:=null;c.private_state:='{}';c.revision:=-1; end if;
    update public.room_game_checkpoints set owner_id=auth.uid(),owner_session=p_session,epoch=c.epoch,
      lease_until=now()+interval '20 seconds',heartbeat_at=now(),public_state=c.public_state,private_state=c.private_state,revision=c.revision
      where room_code=p_room and topic=p_topic returning * into c;
  end if;
  return jsonb_build_object('topic',c.topic,'owner',c.owner_id,'epoch',c.epoch,'owns',acquired,
    'leaseUntil',c.lease_until,'heartbeatAt',c.heartbeat_at,'previousHeartbeatAt',previous_heartbeat,'revision',c.revision,
    'state',c.public_state,'savedAt',c.updated_at,'ownPrivate',c.private_state->'secrets'->auth.uid()::text,
    'payload',case when acquired then c.private_state else null end);
end; $$;

create function public.save_game_checkpoint(p_room text,p_topic text,p_session uuid,p_epoch bigint,p_state jsonb,p_private jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare revision_value bigint; updated integer;
begin
  perform public.require_game_room_member(p_room);
  if jsonb_typeof(p_state)<>'object' or jsonb_typeof(p_private)<>'object' or p_state->>'controllerIdentity'<>auth.uid()::text
    or jsonb_typeof(p_private->'secrets')<>'object' or octet_length(p_state::text)>65536 or octet_length(p_private::text)>524288 then raise exception 'INVALID_CHECKPOINT'; end if;
  revision_value:=(p_state->>'revision')::bigint;
  update public.room_game_checkpoints set public_state=p_state,private_state=p_private,revision=revision_value,
    updated_at=now(),expires_at=now()+interval '24 hours',lease_until=now()+interval '20 seconds',heartbeat_at=now()
    where room_code=p_room and topic=p_topic and owner_id=auth.uid() and owner_session=p_session
      and epoch=p_epoch and lease_until>now() and revision<revision_value;
  get diagnostics updated=row_count;
  if updated<>1 then raise exception 'GAME_LEASE_LOST'; end if;
  return jsonb_build_object('savedAt',now(),'leaseUntil',now()+interval '20 seconds');
end; $$;

create function public.renew_game_checkpoints(p_room text,p_session uuid,p_topics text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.require_game_room_member(p_room);
  if cardinality(p_topics)>12 then raise exception 'INVALID_GAME_TOPIC'; end if;
  with renewed as (
    update public.room_game_checkpoints set lease_until=now()+interval '20 seconds',heartbeat_at=now()
      where room_code=p_room and topic=any(p_topics) and owner_id=auth.uid() and owner_session=p_session and lease_until>now()
      returning topic,lease_until
  ) select coalesce(jsonb_agg(jsonb_build_object('topic',topic,'leaseUntil',lease_until)),'[]') into result from renewed;
  return result;
end; $$;
revoke all on function public.list_game_checkpoints(text,uuid),public.claim_game_checkpoint(text,text,uuid),public.save_game_checkpoint(text,text,uuid,bigint,jsonb,jsonb),public.renew_game_checkpoints(text,uuid,text[]) from public,anon;
grant execute on function public.list_game_checkpoints(text,uuid),public.claim_game_checkpoint(text,text,uuid),public.save_game_checkpoint(text,text,uuid,bigint,jsonb,jsonb),public.renew_game_checkpoints(text,uuid,text[]) to authenticated;
