create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.account_status as enum ('active', 'suspended');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  avatar_data_url text,
  bio text,
  name_color text not null default '#eef1ed',
  name_font text not null default 'mono',
  profile_theme text not null default 'lime',
  avatar_frame text not null default 'ring',
  profile_badge text not null default 'none',
  role public.app_role not null default 'member',
  status public.account_status not null default 'active',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint profiles_display_name_length check (char_length(display_name) <= 48),
  constraint profiles_avatar_length check (avatar_data_url is null or char_length(avatar_data_url) <= 430000),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 96),
  constraint profiles_name_color check (name_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint profiles_name_font check (name_font in ('mono', 'condensed', 'serif', 'rounded')),
  constraint profiles_theme check (profile_theme in ('lime', 'ocean', 'violet', 'ember', 'rose')),
  constraint profiles_avatar_frame check (avatar_frame in ('none', 'ring', 'double', 'glow')),
  constraint profiles_badge check (profile_badge in ('none', 'pilot', 'turbo', 'night', 'mechanic'))
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  assigned_email text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invites_expiry_after_creation check (expires_at > created_at)
);

create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.invites(id) on delete restrict,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

create table if not exists public.livekit_token_issuances (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_name text not null,
  issued_at timestamptz not null default now()
);

create index if not exists livekit_token_issuances_user_time_idx
  on public.livekit_token_issuances(user_id, issued_at desc);
create index if not exists livekit_token_issuances_room_time_idx
  on public.livekit_token_issuances(room_name, issued_at desc);

create table if not exists public.call_events (
  id bigint generated always as identity primary key,
  webhook_id text not null unique,
  event_type text not null,
  room_sid text,
  room_name text,
  participant_identity text,
  participant_name text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists call_events_occurred_at_idx
  on public.call_events(occurred_at desc);
create index if not exists call_events_room_sid_idx
  on public.call_events(room_sid, occurred_at desc);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_invite_id uuid references public.invites(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 48)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (id, email, display_name)
select
  id,
  coalesce(email, ''),
  left(coalesce(raw_user_meta_data ->> 'display_name', ''), 48)
from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function public.redeem_invite(
  p_code_hash text,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_avatar_data_url text default null,
  p_bio text default null,
  p_name_color text default '#eef1ed',
  p_name_font text default 'mono',
  p_profile_theme text default 'lime',
  p_avatar_frame text default 'ring',
  p_profile_badge text default 'none'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_invite public.invites%rowtype;
begin
  select * into selected_invite
  from public.invites
  where code_hash = p_code_hash
    and revoked_at is null
    and redeemed_at is null
    and expires_at > now()
    and (assigned_email is null or lower(assigned_email) = lower(p_email))
  for update;

  if not found then
    return false;
  end if;

  update public.profiles
  set
    email = lower(trim(p_email)),
    display_name = left(trim(p_display_name), 48),
    avatar_data_url = p_avatar_data_url,
    bio = left(trim(p_bio), 96),
    name_color = p_name_color,
    name_font = p_name_font,
    profile_theme = p_profile_theme,
    avatar_frame = p_avatar_frame,
    profile_badge = p_profile_badge,
    invited_by = selected_invite.created_by,
    status = 'active'
  where id = p_user_id;

  update public.invites
  set redeemed_at = now(), redeemed_by = p_user_id
  where id = selected_invite.id;

  insert into public.invite_redemptions (invite_id, user_id)
  values (selected_invite.id, p_user_id);

  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.invite_redemptions enable row level security;
alter table public.livekit_token_issuances enable row level security;
alter table public.call_events enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.invites from anon, authenticated;
revoke all on public.invite_redemptions from anon, authenticated;
revoke all on public.livekit_token_issuances from anon, authenticated;
revoke all on public.call_events from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_data_url, bio, name_color, name_font, profile_theme, avatar_frame, profile_badge, last_seen_at) on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update their own public profile" on public.profiles;
create policy "Users can update their own public profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

revoke all on function public.redeem_invite(text, uuid, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text, uuid, text, text, text, text, text, text, text, text, text) to service_role;
