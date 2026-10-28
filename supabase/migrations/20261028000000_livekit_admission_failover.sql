-- Diagnostics contain fixed codes only, never upstream text or signed URLs.
alter table public.livekit_token_issuances
  add column connection_error_code text,
  add column connection_http_status integer,
  add column connection_client_status integer;

create function public.assign_livekit_backend_v2(
  p_room_name text, p_available_backend_ids text[], p_excluded_backend_ids text[]
) returns text language plpgsql security definer set search_path='' as $$
declare normalized_room text:=upper(trim(p_room_name)); existing_route public.livekit_room_routes%rowtype; selected_id text;
begin
  if normalized_room='' or coalesce(array_length(p_available_backend_ids,1),0)=0 then raise exception 'LIVEKIT_POOL_UNAVAILABLE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fordkall-room:'||normalized_room,0));
  delete from public.livekit_room_routes where room_name=normalized_room and expires_at<=now();
  select route.* into existing_route from public.livekit_room_routes route join public.livekit_backends backend on backend.id=route.backend_id
    where route.room_name=normalized_room and backend.enabled and backend.id=any(p_available_backend_ids)
    and (route.confirmed_at is not null or backend.cooldown_until is null or backend.cooldown_until<=now()) limit 1;
  if found then
    -- A client cannot bypass a pinned room by sending another project's URL/id.
    if existing_route.backend_id=any(coalesce(p_excluded_backend_ids,'{}')) then raise exception 'LIVEKIT_ROOM_UNAVAILABLE'; end if;
    update public.livekit_room_routes set last_used_at=now(),expires_at=now()+interval '12 hours' where room_name=normalized_room;
    return existing_route.backend_id;
  end if;
  delete from public.livekit_room_routes where room_name=normalized_room;
  select id into selected_id from public.livekit_backends
    where enabled and id=any(p_available_backend_ids) and not(id=any(coalesce(p_excluded_backend_ids,'{}')))
    and (cooldown_until is null or cooldown_until<=now())
    order by last_selected_at asc nulls first,rotation_order asc for update limit 1;
  if selected_id is null then raise exception 'LIVEKIT_POOL_UNAVAILABLE'; end if;
  update public.livekit_backends set last_selected_at=now() where id=selected_id;
  insert into public.livekit_room_routes(room_name,backend_id) values(normalized_room,selected_id);
  return selected_id;
end; $$;
revoke all on function public.assign_livekit_backend_v2(text,text[],text[]) from public,anon,authenticated;
grant execute on function public.assign_livekit_backend_v2(text,text[],text[]) to service_role;

-- Preserve the legacy contract for older clients/functions.
create or replace function public.assign_livekit_backend(p_room_name text,p_available_backend_ids text[])
returns text language sql security definer set search_path='' as $$
  select public.assign_livekit_backend_v2(p_room_name,p_available_backend_ids,'{}');
$$;

create or replace function public.report_livekit_backend_connection(
  p_room_name text,p_backend_id text,p_succeeded boolean,p_room_has_participants boolean default false,p_error text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare normalized_room text:=upper(trim(p_room_name)); next_failures integer; removed boolean:=false;
begin
  -- Lock order matches assignment (room, then backend), preventing cross-report deadlocks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fordkall-room:'||normalized_room,0));
  if p_succeeded then
    update public.livekit_backends set consecutive_failures=0,cooldown_until=null,last_success_at=now(),last_error=null where id=p_backend_id;
    update public.livekit_room_routes set confirmed_at=coalesce(confirmed_at,now()),last_used_at=now(),expires_at=now()+interval '12 hours' where room_name=normalized_room and backend_id=p_backend_id;
    return false;
  end if;
  select consecutive_failures+1 into next_failures from public.livekit_backends where id=p_backend_id for update;
  if next_failures is null then return false; end if;
  update public.livekit_backends set consecutive_failures=next_failures,last_failure_at=now(),last_error=left(coalesce(p_error,'CONNECTION_FAILED'),240),
    cooldown_until=case when p_error in('QUOTA_EXCEEDED','AUTH_REJECTED','REGION_UNAVAILABLE','BACKEND_UNAVAILABLE') or next_failures>=2 then now()+interval '5 minutes' else cooldown_until end where id=p_backend_id;
  if not p_room_has_participants and not exists(select 1 from public.livekit_token_issuances where room_name=normalized_room and backend_id=p_backend_id and connection_succeeded is true and room_left_at is null and room_seen_at>now()-interval '90 seconds') then
    delete from public.livekit_room_routes where room_name=normalized_room and backend_id=p_backend_id;
    removed:=found;
  end if;
  return removed;
end; $$;

create or replace function public.release_livekit_room_route(p_room_name text,p_backend_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare normalized_room text:=upper(trim(p_room_name)); removed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fordkall-room:'||normalized_room,0));
  -- Do not race a successful join/heartbeat while handling another client's failed join.
  if exists(select 1 from public.livekit_token_issuances where room_name=normalized_room and backend_id=p_backend_id and connection_succeeded is true and room_left_at is null and room_seen_at>now()-interval '90 seconds') then return false; end if;
  delete from public.livekit_room_routes where room_name=normalized_room and backend_id=p_backend_id;
  removed:=found; return removed;
end; $$;
