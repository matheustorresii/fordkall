alter table public.invites
alter column expires_at drop not null;

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
    and (expires_at is null or expires_at > now())
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
    profile_badge = 'none',
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
