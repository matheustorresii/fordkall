// Disposable local PostgreSQL only. No production secrets, users or rooms.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const bin = process.env.FK_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@17/bin'
assert.ok(
  existsSync(join(bin, 'initdb')),
  'Set FK_POSTGRES_BIN to a local PostgreSQL installation',
)
const dir = mkdtempSync(join(tmpdir(), 'fordkall-session-db-'))
const run = (name, args, input) => {
  const result = spawnSync(join(bin, name), args, {
    input,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`)
  return result.stdout
}
const sql = (input) =>
  run(
    'psql',
    [
      '-h',
      dir,
      '-p',
      '65438',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    input,
  )
let started = false
try {
  run('initdb', [
    '-D',
    join(dir, 'data'),
    '-A',
    'trust',
    '-U',
    'postgres',
    '--no-locale',
  ])
  run('pg_ctl', [
    '-D',
    join(dir, 'data'),
    '-l',
    join(dir, 'server.log'),
    '-o',
    `-h '' -k ${dir} -p 65438`,
    '-w',
    'start',
  ])
  started = true
  sql(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create publication supabase_realtime;
    create table profiles(id uuid primary key,status text);
    create function is_active_social_user() returns boolean language sql stable security definer as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active') $$;
    create table call_rooms(code text primary key,is_private boolean not null,created_by uuid references profiles(id));
    create table livekit_token_issuances(id bigint primary key,user_id uuid,room_name text,connection_succeeded boolean,issued_at timestamptz default now(),room_seen_at timestamptz default now(),room_left_at timestamptz);
    insert into profiles values('11111111-1111-1111-1111-111111111111','active'),('22222222-2222-2222-2222-222222222222','active'),('33333333-3333-3333-3333-333333333333','active'),('44444444-4444-4444-4444-444444444444','active');
    insert into call_rooms values('PUBLIC',false,'11111111-1111-1111-1111-111111111111');
    insert into livekit_token_issuances(id,user_id,room_name,connection_succeeded) values(1,'11111111-1111-1111-1111-111111111111','PUBLIC',true);`)
  for (const file of [
    '20261024010000_direct_calls.sql',
    '20261024020000_game_checkpoints.sql',
    '20261024030000_game_checkpoint_clocks.sql',
  ])
    sql(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  sql(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
    create temporary table qa_call as select * from start_direct_call('22222222-2222-2222-2222-222222222222');
    do $$ begin if not exists(select 1 from call_rooms where code=(select room_code from qa_call) and is_private) then raise exception 'A new direct call must be private'; end if; end $$;
    do $$ begin
      begin perform start_direct_call('22222222-2222-2222-2222-222222222222'); raise exception 'Concurrent ringing allowed'; exception when raise_exception then if sqlerrm<>'CALL_BUSY' then raise; end if; end;
    end $$;
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    do $$ begin
      begin perform respond_direct_call((select id from qa_call),'accept'); raise exception 'Outsider accepted a private call'; exception when raise_exception then if sqlerrm<>'CALL_NOT_FOUND' then raise; end if; end;
    end $$;
    select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
    do $$ begin if (respond_direct_call((select id from qa_call),'accept')).status<>'accepted' then raise exception 'Recipient must accept'; end if;
      begin perform respond_direct_call((select id from qa_call),'accept'); raise exception 'Second device accepted twice'; exception when raise_exception then if sqlerrm<>'CALL_ALREADY_ANSWERED' then raise; end if; end;
    end $$;
    select respond_direct_call((select id from qa_call),'end');
    insert into social_preferences(user_id,do_not_disturb) values(auth.uid(),true);
    select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
    do $$ begin
      begin perform start_direct_call('22222222-2222-2222-2222-222222222222'); raise exception 'DND ignored'; exception when raise_exception then if sqlerrm<>'CALL_DO_NOT_DISTURB' then raise; end if; end;
      begin perform start_direct_call('11111111-1111-1111-1111-111111111111'); raise exception 'Busy participant rang'; exception when raise_exception then if sqlerrm<>'CALL_BUSY' then raise; end if; end;
    end $$;
    update social_preferences set do_not_disturb=false;
    create temporary table qa_expired as select * from start_direct_call('22222222-2222-2222-2222-222222222222');
    update direct_calls set expires_at=now()-interval '1 second' where id=(select id from qa_expired);
    select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
    do $$ begin if (respond_direct_call((select id from qa_expired),'accept')).status<>'missed' then raise exception 'Expired invitation joined'; end if; end $$;
    set role authenticated;
    do $$ begin
      if has_table_privilege(current_user,'public.direct_calls','insert') or has_table_privilege(current_user,'public.direct_calls','update') then raise exception 'Caller/status writable outside RPC'; end if;
      if exists(select 1 from social_preferences where user_id<>auth.uid()) then raise exception 'Private preferences exposed'; end if;
    end $$;
    reset role;

    insert into livekit_token_issuances(id,user_id,room_name,connection_succeeded) values(2,'22222222-2222-2222-2222-222222222222','PUBLIC',true);
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    select claim_game_checkpoint('PUBLIC','ford-kall.poker.v2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    select save_game_checkpoint('PUBLIC','ford-kall.poker.v2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',1,
      '{"gameId":"hand","revision":1,"controllerIdentity":"11111111-1111-1111-1111-111111111111","pot":200}',
      '{"secrets":{"11111111-1111-1111-1111-111111111111":["AS","AH"],"22222222-2222-2222-2222-222222222222":["KS","KH"]},"authority":{"deck":["2S","2H"]}}');
    select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
    do $$ declare value jsonb; begin
      value:=list_game_checkpoints('PUBLIC','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')->0;
      if value->'payload'<>'null'::jsonb or value->'ownPrivate'<>'["KS","KH"]' then raise exception 'Private deck/hands exposed'; end if;
      value:=claim_game_checkpoint('PUBLIC','ford-kall.poker.v2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      if (value->>'owns')::boolean or value->'payload'<>'null'::jsonb then raise exception 'Live authority stolen'; end if;
    end $$;
    update room_game_checkpoints set lease_until=now()-interval '1 second';
    do $$ declare value jsonb; begin
      value:=claim_game_checkpoint('PUBLIC','ford-kall.poker.v2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      if not (value->>'owns')::boolean or (value->>'epoch')::int<>2 or value->'payload'->'authority'->'deck'<>'["2S","2H"]' then raise exception 'Recovery lost authority/deck'; end if;
    end $$;
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    do $$ begin
      begin perform save_game_checkpoint('PUBLIC','ford-kall.poker.v2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',1,'{"revision":2,"controllerIdentity":"11111111-1111-1111-1111-111111111111"}','{"secrets":{}}'); raise exception 'Old authority overwrote new epoch'; exception when raise_exception then if sqlerrm<>'GAME_LEASE_LOST' then raise; end if; end;
    end $$;
    select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
    do $$ begin
      begin perform list_game_checkpoints('PUBLIC','dddddddd-dddd-dddd-dddd-dddddddddddd'); raise exception 'Non-member read checkpoint'; exception when raise_exception then if sqlerrm<>'GAME_ROOM_REQUIRED' then raise; end if; end;
    end $$;
    set role authenticated;
    do $$ begin if has_table_privilege(current_user,'public.room_game_checkpoints','select') then raise exception 'Raw checkpoint table exposed'; end if; end $$;
    reset role;
    set role anon;
    do $$ begin if has_function_privilege(current_user,'public.claim_game_checkpoint(text,text,uuid)','execute') or has_function_privilege(current_user,'public.start_direct_call(uuid,text)','execute') then raise exception 'Anonymous access'; end if; end $$;`)
  console.log(
    'PASS: real PostgreSQL direct calls, privacy, DND, expiry, multi-device acceptance, private checkpoints, fenced takeover, stale writer rejection and RLS',
  )
} finally {
  if (started)
    run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop'])
  rmSync(dir, { recursive: true, force: true })
}
