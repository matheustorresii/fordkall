create or replace function public.release_livekit_room_route(
  p_room_name text,
  p_backend_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_room text := upper(trim(p_room_name));
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fordkall-room:' || normalized_room, 0)
  );

  delete from public.livekit_room_routes
  where room_name = normalized_room
    and backend_id = p_backend_id;

  return found;
end;
$$;

revoke all on function public.release_livekit_room_route(text, text) from public, anon, authenticated;
grant execute on function public.release_livekit_room_route(text, text) to service_role;
