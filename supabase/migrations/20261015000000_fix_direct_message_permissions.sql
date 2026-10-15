-- The previous INSERT policy selected the recipient from profiles as the caller.
-- profiles is intentionally self-only, so that EXISTS was always false for a DM.
-- A narrowly scoped definer checks membership without opening access to profiles.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.can_send_direct_message(p_low uuid, p_high uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_low < p_high
    and auth.uid() in (p_low, p_high)
    and exists (
      select 1 from public.profiles sender
      where sender.id = auth.uid() and sender.status = 'active'
    )
    and exists (
      select 1 from public.profiles recipient
      where recipient.id = case when auth.uid() = p_low then p_high else p_low end
        and recipient.status = 'active'
    );
$$;

revoke all on function private.can_send_direct_message(uuid, uuid) from public, anon;
grant execute on function private.can_send_direct_message(uuid, uuid) to authenticated;

alter policy "Active users can send direct messages"
on public.direct_messages
with check (
  sender_id = (select auth.uid())
  and private.can_send_direct_message(user_low, user_high)
);
