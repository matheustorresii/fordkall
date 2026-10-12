create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_distinct_users check (user_low < user_high),
  constraint direct_messages_sender_in_pair check (sender_id in (user_low, user_high)),
  constraint direct_messages_body_length check (char_length(body) between 1 and 2000)
);

create index if not exists direct_messages_pair_created_idx
  on public.direct_messages (user_low, user_high, created_at desc);
create index if not exists direct_messages_inbox_low_idx
  on public.direct_messages (user_low, created_at desc);
create index if not exists direct_messages_inbox_high_idx
  on public.direct_messages (user_high, created_at desc);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint community_messages_body_length check (char_length(body) between 1 and 2000)
);

create index if not exists community_messages_created_idx
  on public.community_messages (created_at desc);

create or replace function public.is_active_social_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function public.get_social_profile_cards(
  p_user_ids uuid[],
  p_include_avatar boolean default true
)
returns table (
  id uuid,
  display_name text,
  avatar_data_url text,
  bio text,
  name_color text,
  name_font text,
  profile_theme text,
  profile_accent_color text,
  avatar_frame text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_social_user() then
    raise exception 'ACTIVE_ACCOUNT_REQUIRED';
  end if;
  if coalesce(cardinality(p_user_ids), 0) > 20 then
    raise exception 'SOCIAL_PROFILE_BATCH_LIMIT';
  end if;

  return query
  select
    p.id,
    p.display_name,
    case when p_include_avatar then p.avatar_data_url else null end,
    p.bio,
    p.name_color,
    p.name_font,
    p.profile_theme,
    p.profile_accent_color,
    p.avatar_frame
  from public.profiles p
  where p.id = any(coalesce(p_user_ids, '{}'::uuid[]))
    and p.status = 'active';
end;
$$;

create or replace function public.search_social_users(p_query text default '')
returns table (
  id uuid,
  display_name text,
  avatar_data_url text,
  bio text,
  name_color text,
  name_font text,
  profile_theme text,
  profile_accent_color text,
  avatar_frame text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  query_value text := left(trim(coalesce(p_query, '')), 48);
begin
  if not public.is_active_social_user() then
    raise exception 'ACTIVE_ACCOUNT_REQUIRED';
  end if;
  if char_length(query_value) = 1 then
    return;
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.avatar_data_url,
    p.bio,
    p.name_color,
    p.name_font,
    p.profile_theme,
    p.profile_accent_color,
    p.avatar_frame
  from public.profiles p
  where p.status = 'active'
    and p.id <> auth.uid()
    and (
      query_value = ''
      or position(lower(query_value) in lower(p.display_name)) > 0
    )
  order by p.last_seen_at desc nulls last, p.created_at desc
  limit 30;
end;
$$;

alter table public.direct_messages enable row level security;
alter table public.community_messages enable row level security;

revoke all on public.direct_messages, public.community_messages from anon, authenticated;
grant select, insert on public.direct_messages to authenticated;
grant update (read_at) on public.direct_messages to authenticated;
grant select, insert on public.community_messages to authenticated;

drop policy if exists "Active users can read their direct messages" on public.direct_messages;
create policy "Active users can read their direct messages"
on public.direct_messages for select to authenticated
using (
  public.is_active_social_user()
  and auth.uid() in (user_low, user_high)
);

drop policy if exists "Active users can send direct messages" on public.direct_messages;
create policy "Active users can send direct messages"
on public.direct_messages for insert to authenticated
with check (
  public.is_active_social_user()
  and sender_id = auth.uid()
  and auth.uid() in (user_low, user_high)
  and exists (
    select 1 from public.profiles recipient
    where recipient.id = case
      when user_low = auth.uid() then user_high
      else user_low
    end
      and recipient.status = 'active'
  )
);

drop policy if exists "Recipients can mark direct messages read" on public.direct_messages;
create policy "Recipients can mark direct messages read"
on public.direct_messages for update to authenticated
using (
  public.is_active_social_user()
  and sender_id <> auth.uid()
  and auth.uid() in (user_low, user_high)
)
with check (
  public.is_active_social_user()
  and sender_id <> auth.uid()
  and auth.uid() in (user_low, user_high)
);

drop policy if exists "Active users can read community messages" on public.community_messages;
create policy "Active users can read community messages"
on public.community_messages for select to authenticated
using (public.is_active_social_user());

drop policy if exists "Active users can send community messages" on public.community_messages;
create policy "Active users can send community messages"
on public.community_messages for insert to authenticated
with check (public.is_active_social_user() and sender_id = auth.uid());

revoke all on function public.is_active_social_user() from public, anon;
grant execute on function public.is_active_social_user() to authenticated;
revoke all on function public.get_social_profile_cards(uuid[], boolean) from public, anon;
grant execute on function public.get_social_profile_cards(uuid[], boolean) to authenticated;
revoke all on function public.search_social_users(text) from public, anon;
grant execute on function public.search_social_users(text) to authenticated;

drop policy if exists "Active users can see social presence" on realtime.messages;
create policy "Active users can see social presence"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'fordkall:online'
  and public.is_active_social_user()
);

drop policy if exists "Active users can publish social presence" on realtime.messages;
create policy "Active users can publish social presence"
on realtime.messages for insert to authenticated
with check (
  extension = 'presence'
  and realtime.topic() = 'fordkall:online'
  and public.is_active_social_user()
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['direct_messages', 'community_messages'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
