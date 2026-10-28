// Real PostgreSQL, disposable local cluster only. Never uses production credentials.
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
const dir = mkdtempSync(join(tmpdir(), 'fordkall-failover-db-'))
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
      '65437',
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
    `-h '' -k ${dir} -p 65437`,
    '-w',
    'start',
  ])
  started = true
  sql(`create role anon; create role authenticated; create role service_role;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
    create table livekit_token_issuances(id bigint primary key,user_id uuid,room_name text,issued_at timestamptz default now(),room_seen_at timestamptz,room_left_at timestamptz);
    create table call_events(id bigint primary key);`)
  for (const migration of [
    '20260927000000_livekit_backend_rotation.sql',
    '20260927000001_harden_livekit_connection_reports.sql',
    '20261028000000_livekit_admission_failover.sql',
  ])
    sql(readFileSync(`supabase/migrations/${migration}`, 'utf8'))
  sql(`do $$ declare chosen text; begin
    chosen:=assign_livekit_backend_v2('EMPTY',array['primary','reserve-2','reserve-3'],'{}');
    if chosen<>'primary' then raise exception 'Unexpected initial project'; end if;
    -- API health does not override an RTC quota failure. First confirmed failure cools down immediately.
    if not report_livekit_backend_connection('EMPTY','primary',false,false,'QUOTA_EXCEEDED') then raise exception 'Empty route was not released'; end if;
    if not exists(select 1 from livekit_backends where id='primary' and cooldown_until>now()) then raise exception 'Quota project remains eligible'; end if;
    chosen:=assign_livekit_backend_v2('EMPTY',array['primary','reserve-2','reserve-3'],array['primary']);
    if chosen<>'reserve-2' then raise exception 'Failed project repeated'; end if;
    if not release_livekit_room_route('EMPTY','reserve-2') then raise exception 'Unoccupied route stayed pinned'; end if;
    chosen:=assign_livekit_backend_v2('EMPTY',array['primary','reserve-2','reserve-3'],array['primary','reserve-2']);
    if chosen<>'reserve-3' then raise exception 'Third project was not attempted'; end if;
    perform release_livekit_room_route('EMPTY','reserve-3');
    begin perform assign_livekit_backend_v2('EMPTY',array['primary','reserve-2','reserve-3'],array['primary','reserve-2','reserve-3']);
      raise exception 'Exhausted pool returned a project'; exception when raise_exception then if sqlerrm<>'LIVEKIT_POOL_UNAVAILABLE' then raise; end if; end;
    end $$;
    update livekit_backends set cooldown_until=null,last_selected_at=null;
    select assign_livekit_backend_v2('ACTIVE',array['primary'],'{}');
    select report_livekit_backend_connection('ACTIVE','primary',true,true,null);
    insert into livekit_token_issuances(id,user_id,room_name,backend_id,connection_succeeded,room_seen_at)
      values(1,'11111111-1111-1111-1111-111111111111','ACTIVE','primary',true,now());
    do $$ begin
      if release_livekit_room_route('ACTIVE','primary') then raise exception 'A racing failed join moved an occupied room'; end if;
      if report_livekit_backend_connection('ACTIVE','primary',false,false,'BACKEND_UNAVAILABLE') then raise exception 'A concurrent successful join was ignored'; end if;
      begin perform assign_livekit_backend_v2('ACTIVE',array['primary','reserve-2'],array['primary']);
        raise exception 'Excluded a pinned project and split the room'; exception when raise_exception then if sqlerrm<>'LIVEKIT_ROOM_UNAVAILABLE' then raise; end if; end;
      if assign_livekit_backend('ACTIVE',array['primary','reserve-2'])<>'primary' then raise exception 'Legacy assignment bypassed the pinned room'; end if;
    end $$;
    update livekit_token_issuances set room_left_at=now() where id=1;
    do $$ begin if not release_livekit_room_route('ACTIVE','primary') then raise exception 'Empty room did not become movable'; end if; end $$;
    update livekit_backends set cooldown_until=now()+interval '5 minutes';
    do $$ begin
      begin perform assign_livekit_backend_v2('OUTAGE',array['primary','reserve-2','reserve-3'],'{}');
        raise exception 'Pool cooldown was ignored'; exception when raise_exception then if sqlerrm<>'LIVEKIT_POOL_UNAVAILABLE' then raise; end if; end;
    end $$;
    set role authenticated;
    do $$ begin if has_function_privilege(current_user,'public.assign_livekit_backend_v2(text,text[],text[])','execute') or has_function_privilege(current_user,'public.report_livekit_backend_connection(text,text,boolean,boolean,text)','execute') or has_table_privilege(current_user,'public.livekit_backends','update') then raise exception 'Client can poison routing'; end if; end $$;
    reset role;`)
  console.log(
    'PASS: real PostgreSQL failover, no repeated projects, cooldown, exhausted pool, pinned rooms, join races, legacy compatibility and permissions',
  )
} finally {
  if (started)
    run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop'])
  rmSync(dir, { recursive: true, force: true })
}
