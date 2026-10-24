// Runs the real migration against a disposable, isolated PostgreSQL cluster. No production keys.
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
const dir = mkdtempSync(join(tmpdir(), 'fordkall-room-db-'))
const run = (name, args, input) => {
  const result = spawnSync(join(bin, name), args, {
    input,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`)
  return result.stdout
}
const sql = (text) =>
  run(
    'psql',
    [
      '-h',
      dir,
      '-p',
      '65439',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    text,
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
    `-h '' -k ${dir} -p 65439`,
    '-w',
    'start',
  ])
  started = true
  sql(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,status text);
    create function public.is_active_social_user() returns boolean language sql stable security definer as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active') $$;
    create table public.livekit_backends(id text primary key);
    create table public.livekit_room_routes(room_name text primary key,backend_id text references public.livekit_backends(id));
    create table public.livekit_token_issuances(id bigint primary key,user_id uuid,room_name text,issued_at timestamptz default now(),connection_succeeded boolean);
    insert into profiles values('11111111-1111-1111-1111-111111111111','active'),('22222222-2222-2222-2222-222222222222','active'),('33333333-3333-3333-3333-333333333333','active');
    insert into livekit_backends values('primary');`)
  sql(
    readFileSync(
      'supabase/migrations/20261021000000_call_privacy_cosmetics.sql',
      'utf8',
    ).split('alter table public.profiles add column')[0],
  )
  sql(
    readFileSync(
      'supabase/migrations/20261024000000_reliable_room_directory.sql',
      'utf8',
    ),
  )
  sql(`insert into call_rooms(code,is_private,created_by) values('PUBLIC',false,'11111111-1111-1111-1111-111111111111'),('PRIVATE',true,'22222222-2222-2222-2222-222222222222');
    insert into livekit_room_routes values('PUBLIC','primary');
    insert into call_room_members values('PUBLIC','11111111-1111-1111-1111-111111111111',now()-interval '5 minutes'),('PRIVATE','22222222-2222-2222-2222-222222222222',now());
    insert into livekit_token_issuances(id,user_id,room_name,connection_succeeded,room_seen_at) values
      (1,'11111111-1111-1111-1111-111111111111','PUBLIC',true,now()),(2,'11111111-1111-1111-1111-111111111111','PUBLIC',true,now()),(3,'22222222-2222-2222-2222-222222222222','PRIVATE',true,now()),(4,'11111111-1111-1111-1111-111111111111','PUBLIC',null,null);
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    do $$ begin if exists(select 1 from list_public_call_rooms()) then raise exception 'Legacy stale browser attendance must expire'; end if; end $$;
    do $$ declare lease uuid; begin lease:=claim_call_directory_refresh('primary');
      if lease is null or claim_call_directory_refresh('primary') is not null then raise exception 'Shared lease failed'; end if;
      if finish_call_directory_refresh('primary',gen_random_uuid(),'[]') then raise exception 'Stale lease accepted'; end if;
      perform finish_call_directory_refresh('primary',lease,'[{"code":"PUBLIC","user_ids":["11111111-1111-1111-1111-111111111111"]},{"code":"PRIVATE","user_ids":["22222222-2222-2222-2222-222222222222"]}]'); end $$;
    do $$ begin
      if not exists(select 1 from list_public_call_rooms() where code='PUBLIC') then raise exception 'LiveKit snapshot must restore a room despite expired browser timers'; end if;
      if exists(select 1 from call_room_live_snapshots where room_code='PRIVATE') or exists(select 1 from list_public_call_rooms() where code='PRIVATE') then raise exception 'Private room leak'; end if;
    end $$;
    select touch_call_room('PUBLIC',true,1);
    select touch_call_room('PUBLIC',false,2);
    select touch_call_room('PUBLIC',true,1);
    do $$ begin
      if touch_call_room('PUBLIC',false,1) then raise exception 'Closed session reopened'; end if;
      if not exists(select 1 from call_room_members where room_code='PUBLIC' and seen_at>now()-interval '90 seconds') then raise exception 'Late leave removed the new connection'; end if;
      if touch_call_room('PRIVATE',true,3) then raise exception 'Another account session was modified'; end if;
      if touch_call_room('PUBLIC',false,4) then raise exception 'Unconfirmed token fabricated attendance'; end if;
      if not touch_call_room('PUBLIC',true,4) then raise exception 'Pending connection must be cancellable before the success report arrives'; end if;
      if exists(select 1 from list_my_call_rooms() where code='PRIVATE') then raise exception 'Personal history leaked another account private room'; end if;
    end $$;
    select touch_call_room('PUBLIC',true,2);
    do $$ begin if not exists(select 1 from list_my_call_rooms() where code='PUBLIC') then raise exception 'Leaving destroyed room history'; end if; end $$;
    select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
    do $$ begin if not exists(select 1 from list_my_call_rooms() where code='PRIVATE' and is_private) then raise exception 'Private history missing'; end if; end $$;
    update call_directory_sync set attempted_at=now()-interval '1 minute';
    do $$ declare lease uuid; begin lease:=claim_call_directory_refresh('primary'); perform finish_call_directory_refresh('primary',lease,null);
      if not exists(select 1 from list_public_call_rooms() where code='PUBLIC') then raise exception 'A failed API erased live rooms'; end if; end $$;
    update call_directory_sync set attempted_at=now()-interval '1 minute';
    do $$ declare lease uuid; begin lease:=claim_call_directory_refresh('primary'); perform finish_call_directory_refresh('primary',lease,'[]');
      if exists(select 1 from list_public_call_rooms()) then raise exception 'Confirmed empty server must clear ghost rooms'; end if; end $$;
    set role authenticated;
    do $$ begin
      if has_table_privilege(current_user,'public.call_rooms','select') or has_table_privilege(current_user,'public.call_room_live_snapshots','select') then raise exception 'Raw registry became readable'; end if;
      if has_function_privilege(current_user,'public.claim_call_directory_refresh(text)','execute') then raise exception 'Client can poison the server cache'; end if;
      perform list_public_call_rooms(); perform list_my_call_rooms();
    end $$;
    reset role;
    set role anon;
    do $$ begin if has_function_privilege(current_user,'public.list_my_call_rooms()','execute') then raise exception 'Anonymous history access'; end if; end $$;`)
  console.log(
    'PASS: real PostgreSQL migration, background recovery, privacy, per-account history, rejoin races, scoped sessions, shared leases, API failure and RLS checks',
  )
} finally {
  if (started)
    run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop'])
  rmSync(dir, { recursive: true, force: true })
}
