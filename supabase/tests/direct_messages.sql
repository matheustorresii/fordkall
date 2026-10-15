-- Run against the linked database with `supabase db query --linked --file ...`.
-- Synthetic accounts and every message are rolled back; no real inbox is touched.
begin;
set local statement_timeout = '15s';

create function pg_temp.assert_dm(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'DM regression: %', label; end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('b20cd000-0000-4000-8000-000000000001', 'dm-qa-a@fordkall.invalid', '{"display_name":"DM QA A"}'),
  ('b20cd000-0000-4000-8000-000000000002', 'dm-qa-b@fordkall.invalid', '{"display_name":"DM QA B"}'),
  ('b20cd000-0000-4000-8000-000000000003', 'dm-qa-c@fordkall.invalid', '{"display_name":"DM QA C"}'),
  ('b20cd000-0000-4000-8000-000000000004', 'dm-qa-d@fordkall.invalid', '{"display_name":"DM QA suspended"}');
update public.profiles set status = 'suspended'
where id = 'b20cd000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b20cd000-0000-4000-8000-000000000001', true);
select pg_temp.assert_dm(
  (select count(*) = 1 from public.profiles where id in (
    'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000002'
  )), 'private profiles must remain private'
);

-- B has never been online. Persisting a DM must not depend on presence.
insert into public.direct_messages (id, user_low, user_high, sender_id, body) values (
  'b20cd100-0000-4000-8000-000000000001',
  'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000002',
  'b20cd000-0000-4000-8000-000000000001', 'Offline delivery regression'
) returning id;
select pg_temp.assert_dm(
  exists(select 1 from public.direct_messages where id = 'b20cd100-0000-4000-8000-000000000001'),
  'sender can read the inserted message (INSERT RETURNING)'
);

do $$ begin
  begin
    insert into public.direct_messages (user_low, user_high, sender_id, body) values (
      'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000002',
      'b20cd000-0000-4000-8000-000000000002', 'Spoofed sender'
    );
    raise exception 'DM regression: sender spoofing was allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.direct_messages (user_low, user_high, sender_id, body) values (
      'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000004',
      'b20cd000-0000-4000-8000-000000000001', 'Suspended recipient'
    );
    raise exception 'DM regression: suspended recipient was allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.direct_messages set body = 'Modified' where id = 'b20cd100-0000-4000-8000-000000000001';
    raise exception 'DM regression: editing message bodies was allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.direct_messages where id = 'b20cd100-0000-4000-8000-000000000001';
    raise exception 'DM regression: deleting messages was allowed';
  exception when insufficient_privilege then null; end;
end; $$;

-- Senders cannot mark their own messages as read.
with changed as (
  update public.direct_messages set read_at = now()
  where id = 'b20cd100-0000-4000-8000-000000000001' returning id
) select pg_temp.assert_dm((select count(*) = 0 from changed), 'sender cannot set a read receipt');

select set_config('request.jwt.claim.sub', 'b20cd000-0000-4000-8000-000000000002', true);
select pg_temp.assert_dm(
  exists(select 1 from public.direct_messages where id = 'b20cd100-0000-4000-8000-000000000001' and read_at is null),
  'offline recipient receives persisted history on return'
);
with changed as (
  update public.direct_messages set read_at = now()
  where id = 'b20cd100-0000-4000-8000-000000000001' returning id
) select pg_temp.assert_dm((select count(*) = 1 from changed), 'recipient can mark a message read');
insert into public.direct_messages (id, user_low, user_high, sender_id, body) values (
  'b20cd100-0000-4000-8000-000000000002',
  'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000002',
  'b20cd000-0000-4000-8000-000000000002', 'Reply regression'
) returning id;

select set_config('request.jwt.claim.sub', 'b20cd000-0000-4000-8000-000000000003', true);
select pg_temp.assert_dm(
  (select count(*) = 0 from public.direct_messages where id in (
    'b20cd100-0000-4000-8000-000000000001', 'b20cd100-0000-4000-8000-000000000002'
  )), 'third parties cannot read the conversation'
);
do $$ begin
  begin
    insert into public.direct_messages (user_low, user_high, sender_id, body) values (
      'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000002',
      'b20cd000-0000-4000-8000-000000000003', 'Third party'
    );
    raise exception 'DM regression: third-party insertion was allowed';
  exception when insufficient_privilege then null; end;
end; $$;

select set_config('request.jwt.claim.sub', 'b20cd000-0000-4000-8000-000000000004', true);
select pg_temp.assert_dm(
  (select count(*) = 0 from public.direct_messages where id = 'b20cd100-0000-4000-8000-000000000001'),
  'suspended accounts cannot read messages'
);
do $$ begin
  begin
    insert into public.direct_messages (user_low, user_high, sender_id, body) values (
      'b20cd000-0000-4000-8000-000000000001', 'b20cd000-0000-4000-8000-000000000004',
      'b20cd000-0000-4000-8000-000000000004', 'Suspended sender'
    );
    raise exception 'DM regression: suspended sender was allowed';
  exception when insufficient_privilege then null; end;
end; $$;

set local role anon;
do $$ begin
  begin
    perform 1 from public.direct_messages limit 1;
    raise exception 'DM regression: anonymous access was allowed';
  exception when insufficient_privilege then null; end;
end; $$;

reset role;
select pg_temp.assert_dm(
  (select count(*) = 2 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename in ('direct_messages', 'community_messages')),
  'message tables must be published for realtime'
);

rollback;
select 'DM permissions, offline delivery, replies and privacy: passed; fixtures rolled back' as result;
