alter table public.profiles
add column if not exists profile_accent_color text;

update public.profiles
set profile_accent_color = case profile_theme
  when 'ocean' then '#57d6ff'
  when 'violet' then '#a98bff'
  when 'ember' then '#ff9857'
  when 'rose' then '#ff6fae'
  else '#b9ef3a'
end
where profile_accent_color is null;

alter table public.profiles
alter column profile_accent_color set default '#b9ef3a',
alter column profile_accent_color set not null;

do $$ begin
  alter table public.profiles
  add constraint profiles_accent_color check (profile_accent_color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null;
end $$;

grant update (profile_accent_color) on public.profiles to authenticated;
