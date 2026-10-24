-- PC clocks can differ. Lease checks use server time; decision timers keep their remaining time on takeover.
create or replace function public.list_game_checkpoints(p_room text,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.require_game_room_member(p_room);
  select coalesce(jsonb_agg(jsonb_build_object(
    'serverNow',now(),'clockAt',c.private_state->'clockAt',
    'topic',c.topic,'owner',c.owner_id,'epoch',c.epoch,'owns',c.owner_id=auth.uid() and c.owner_session=p_session,
    'leaseUntil',c.lease_until,'heartbeatAt',c.heartbeat_at,'revision',c.revision,'state',c.public_state,'savedAt',c.updated_at,
    'ownPrivate',c.private_state->'secrets'->auth.uid()::text,
    'payload',case when c.owner_id=auth.uid() and c.owner_session=p_session then c.private_state else null end
  )),'[]') into result from public.room_game_checkpoints c where c.room_code=p_room and c.expires_at>now();
  return result;
end; $$;
create or replace function public.claim_game_checkpoint(p_room text,p_topic text,p_session uuid)
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
  return jsonb_build_object('serverNow',now(),'clockAt',c.private_state->'clockAt',
    'topic',c.topic,'owner',c.owner_id,'epoch',c.epoch,'owns',acquired,
    'leaseUntil',c.lease_until,'heartbeatAt',c.heartbeat_at,'previousHeartbeatAt',previous_heartbeat,'revision',c.revision,
    'state',c.public_state,'savedAt',c.updated_at,'ownPrivate',c.private_state->'secrets'->auth.uid()::text,
    'payload',case when acquired then c.private_state else null end);
end; $$;
create or replace function public.renew_game_checkpoints(p_room text,p_session uuid,p_topics text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.require_game_room_member(p_room);
  if cardinality(p_topics)>12 then raise exception 'INVALID_GAME_TOPIC'; end if;
  with renewed as (
    update public.room_game_checkpoints set lease_until=now()+interval '20 seconds',heartbeat_at=now()
      where room_code=p_room and topic=any(p_topics) and owner_id=auth.uid() and owner_session=p_session and lease_until>now()
      returning topic,lease_until
  ) select coalesce(jsonb_agg(jsonb_build_object('topic',topic,'leaseUntil',lease_until,'serverNow',now())),'[]') into result from renewed;
  return result;
end; $$;
