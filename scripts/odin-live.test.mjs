// Explicitly opted-in smoke test: two disposable accounts and one private QA room.
// It exercises database recovery only. No LiveKit token, WebSocket, media or user call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  createOdinMatch,
  odinPrivateFor,
  applyOdinMove,
} from '../src/games/odin.ts'
if (!process.argv.includes('--linked'))
  throw Error('Use --linked for the disposable production QA test')
const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
const credentials = spawnSync(
  'node_modules/.bin/supabase',
  ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'],
  { encoding: 'utf8' },
)
assert.equal(credentials.status, 0, 'Could not read linked project credentials')
const keys = JSON.parse(credentials.stdout)
const secret = keys.find((key) => key.name === 'service_role')?.api_key
const publishable =
  keys.find((key) => key.type === 'publishable')?.api_key ||
  keys.find((key) => key.name === 'anon')?.api_key
assert.ok(secret && publishable)
const url = `https://${ref}.supabase.co`,
  options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(30000) }),
    },
  }
const admin = createClient(url, secret, options),
  users = [],
  clients = [],
  sessions = [randomUUID(), randomUUID()]
const topic = 'ford-kall.odin.v1',
  code = `QA-ODIN-${randomUUID().slice(0, 8).toUpperCase()}`
const ok = (result, label) => {
  assert.ok(!result.error, `${label} failed`)
  return result.data
}
try {
  for (let i = 0; i < 2; i++) {
    const password = randomBytes(32).toString('base64url')
    const created = ok(
      await admin.auth.admin.createUser({
        email: `fk-odin-${randomUUID()}@example.invalid`,
        password,
        email_confirm: true,
        user_metadata: { display_name: `ODIN QA ${i + 1}` },
      }),
      'Create QA account',
    )
    users.push(created.user)
    const client = createClient(url, publishable, options)
    ok(
      await client.auth.signInWithPassword({
        email: created.user.email,
        password,
      }),
      'QA sign in',
    )
    clients.push(client)
  }
  ok(
    await admin
      .from('call_rooms')
      .insert({ code, is_private: true, created_by: users[0].id }),
    'Create QA room',
  )
  // Only these synthetic records authorize the checkpoint RPC. No backend ID or health report is touched.
  ok(
    await admin
      .from('livekit_token_issuances')
      .insert(
        users.map((user) => ({
          user_id: user.id,
          room_name: code,
          connection_succeeded: true,
        })),
      ),
    'Authorize QA checkpoint sessions',
  )
  const engine = createOdinMatch(
    users.map((user, i) => ({ identity: user.id, name: `ODIN QA ${i + 1}` })),
  )
  engine.state.controllerIdentity = users[0].id
  engine.state.revision = 1
  const backup = (value) => ({
    authority: value,
    secrets: Object.fromEntries(
      users.map((user) => [user.id, odinPrivateFor(value, user.id)]),
    ),
    clockAt: Date.now(),
  })
  const args = (index) => ({
    p_room: code,
    p_topic: topic,
    p_session: sessions[index],
  })
  const first = ok(
    await clients[0].rpc('claim_game_checkpoint', args(0)),
    'Claim ODIN',
  )
  assert.equal(first.owns, true)
  ok(
    await clients[0].rpc('save_game_checkpoint', {
      ...args(0),
      p_epoch: first.epoch,
      p_state: engine.state,
      p_private: backup(engine),
    }),
    'Save private ODIN engine',
  )
  const records = ok(
    await clients[1].rpc('list_game_checkpoints', {
      p_room: code,
      p_session: sessions[1],
    }),
    'Read own ODIN hand',
  )
  const peer = records.find((record) => record.topic === topic)
  assert.deepEqual(peer.ownPrivate, odinPrivateFor(engine, users[1].id))
  assert.equal(peer.payload, null)
  assert.ok(!('hands' in peer.state) && !('aside' in peer.state))
  console.log(
    'PASS: deployed ODIN checkpoint returns only the recipient hand; no private engine in public state',
  )
  const blocked = ok(
    await clients[1].rpc('claim_game_checkpoint', args(1)),
    'Claim while lease active',
  )
  assert.equal(blocked.owns, false)
  assert.equal(blocked.payload, null)
  ok(
    await admin
      .from('room_game_checkpoints')
      .update({ lease_until: new Date(Date.now() - 1000).toISOString() })
      .eq('room_code', code)
      .eq('topic', topic),
    'Expire QA lease',
  )
  const recovered = ok(
    await clients[1].rpc('claim_game_checkpoint', args(1)),
    'Recover expired ODIN',
  )
  assert.equal(recovered.owns, true)
  assert.equal(recovered.epoch, first.epoch + 1)
  assert.deepEqual(recovered.payload.authority, engine)
  const continued = applyOdinMove(
    recovered.payload.authority,
    engine.state.current,
    { type: 'play', cardIds: [engine.hands[engine.state.current][0].id] },
  )
  continued.state.controllerIdentity = users[1].id
  continued.state.revision = 2
  ok(
    await clients[1].rpc('save_game_checkpoint', {
      ...args(1),
      p_epoch: recovered.epoch,
      p_state: continued.state,
      p_private: backup(continued),
    }),
    'Save recovered ODIN move',
  )
  const stale = await clients[0].rpc('save_game_checkpoint', {
    ...args(0),
    p_epoch: first.epoch,
    p_state: { ...engine.state, revision: 3 },
    p_private: backup(engine),
  })
  assert.ok(stale.error?.message.includes('GAME_LEASE_LOST'))
  assert.ok(
    (
      await clients[1]
        .from('room_game_checkpoints')
        .select('*')
        .eq('room_code', code)
    ).error,
  )
  const anonymous = createClient(url, publishable, options)
  assert.ok((await anonymous.rpc('claim_game_checkpoint', args(0))).error)
  console.log(
    'PASS: deployed takeover preserves every card, accepts the next move, rejects stale owners and denies raw/anonymous access',
  )
} finally {
  ok(
    await admin.from('call_rooms').delete().eq('code', code),
    'Remove disposable QA room',
  )
  ok(
    await admin.from('livekit_token_issuances').delete().eq('room_name', code),
    'Remove synthetic QA sessions',
  )
  for (const user of users)
    ok(
      await admin.auth.admin.deleteUser(user.id),
      'Remove disposable QA account',
    )
  console.log(
    'CLEANUP: disposable ODIN accounts, private room, checkpoints and synthetic sessions removed',
  )
}
