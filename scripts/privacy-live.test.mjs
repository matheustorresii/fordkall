// Disposable QA users only. Secrets never leave memory or appear in logs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
if (!process.argv.includes('--linked'))
  throw Error('Use --linked to authorize the integration test')
const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
const result = spawnSync(
  'node_modules/.bin/supabase',
  ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'],
  { encoding: 'utf8' },
)
assert.equal(result.status, 0)
const keys = JSON.parse(result.stdout),
  service = keys.find((k) => k.name === 'service_role')?.api_key,
  pub =
    keys.find((k) => k.type === 'publishable')?.api_key ||
    keys.find((k) => k.name === 'anon')?.api_key
assert.ok(service && pub)
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
  },
}
const admin = createClient(`https://${ref}.supabase.co`, service, options),
  clients = [],
  users = [],
  codes = []
const unwrap = ({ data, error }, label) => {
  if (error) throw Error(`${label}: ${error.code || error.name}`)
  return data
}
const run = randomUUID(),
  password = randomBytes(32).toString('base64url')
try {
  for (let i = 0; i < 3; i++) {
    const { user } = unwrap(
      await admin.auth.admin.createUser({
        email: `fk-v110-${run}-${i}@example.invalid`,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Private room QA ${i}` },
      }),
      'Create QA account',
    )
    users.push(user)
    const client = createClient(`https://${ref}.supabase.co`, pub, options)
    clients.push(client)
    unwrap(
      await client.auth.signInWithPassword({ email: user.email, password }),
      'Sign in',
    )
  }
  const privateCode = `QA-PRIVATE-${run.slice(0, 8).toUpperCase()}`,
    publicCode = `QA-PUBLIC-${run.slice(0, 8).toUpperCase()}`
  codes.push(privateCode, publicCode)
  const privateToken = unwrap(
    await clients[0].functions.invoke('livekit-token', {
      body: { roomCode: privateCode, privateRoom: true },
    }),
    'Private token',
  )
  assert.equal(privateToken.privateRoom, true)
  const joined = unwrap(
    await clients[1].functions.invoke('livekit-token', {
      body: { roomCode: privateCode, privateRoom: false },
    }),
    'Join private room by code',
  )
  assert.equal(joined.privateRoom, true, 'Joining cannot downgrade privacy')
  const publicToken = unwrap(
    await clients[0].functions.invoke('livekit-token', {
      body: { roomCode: publicCode },
    }),
    'Public token',
  )
  // No media transport is opened by this test. Report successful QA connections to
  // exercise account history/permissions; real server attendance is tested separately.
  for (const [client, roomCode, token] of [[clients[0], privateCode, privateToken], [clients[1], privateCode, joined], [clients[0], publicCode, publicToken]]) {
    unwrap(await client.functions.invoke('livekit-token', { body: { action: 'report', roomCode, backendId: token.backendId, connectionAttemptId: token.connectionAttemptId, succeeded: true } }), 'Confirm QA connection')
  }
  for (const client of clients) {
    const rooms = unwrap(
      await client.rpc('list_public_call_rooms'),
      'List public rooms',
    )
    assert.ok(!rooms.some((r) => r.code === privateCode))
  }
  const ownerHistory = unwrap(await clients[0].rpc('list_my_call_rooms'), 'Personal history')
  const outsiderHistory = unwrap(await clients[2].rpc('list_my_call_rooms'), 'Outsider history')
  assert.ok(ownerHistory.some(room => room.code === privateCode && room.is_private))
  assert.ok(!outsiderHistory.some(room => room.code === privateCode))
  for (const [index, client] of clients.entries()) {
    const directory = unwrap(
      await client.functions.invoke('call-directory', { body: {} }),
      'Authenticated room directory',
    )
    assert.ok(Array.isArray(directory.rooms))
    assert.ok(Array.isArray(directory.recentRooms))
    assert.equal(typeof directory.degraded, 'boolean')
    assert.ok(Number.isFinite(Date.parse(directory.checkedAt)))
    assert.ok(!directory.rooms.some(room => room.code === privateCode))
    assert.equal(
      directory.recentRooms.some(room => room.code === privateCode && room.is_private),
      index < 2,
      'Only accounts that joined a private room can recover it from history',
    )
    assert.ok(!JSON.stringify(directory).includes(service))
  }
  const anonymousDirectory = await fetch(
    `https://${ref}.supabase.co/functions/v1/call-directory`,
    { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: '{}' },
  )
  assert.equal(anonymousDirectory.status, 401)
  assert.ok((await clients[2].from('call_rooms').select('*')).error)
  assert.ok((await clients[2].from('call_room_members').select('*')).error)
  assert.ok((await clients[2].from('call_directory_sync').select('*')).error)
  assert.ok((await clients[2].from('call_room_live_snapshots').select('*')).error)
  assert.ok((await clients[2].rpc('claim_call_directory_refresh', { p_backend_id: 'qa-forbidden' })).error)
  console.log(
    'PASS: authenticated edge directory and RPCs isolate private history; anonymous/cache access rejected; code join preserves privacy',
  )
  unwrap(
    await clients[2].rpc('touch_call_room', { p_room_code: publicCode }),
    'Try unauthorized heartbeat',
  )
  const listed = unwrap(
    await clients[2].rpc('list_public_call_rooms'),
    'List after heartbeat',
  )
  assert.ok(
    !listed.find((r) => r.code === publicCode)?.user_ids.includes(users[2].id),
  )
  unwrap(
    await clients[0].rpc('touch_call_room', {
      p_room_code: publicCode,
      p_leave: true,
      p_session_id: publicToken.connectionAttemptId,
    }),
    'Leave public call',
  )
  assert.ok(unwrap(await clients[0].rpc('list_my_call_rooms'), 'History after leave').some(room => room.code === publicCode))
  assert.ok(
    !unwrap(
      await clients[2].rpc('list_public_call_rooms'),
      'List after leave',
    ).some((r) => r.code === publicCode),
  )
  console.log(
    'PASS: membership heartbeat cannot fabricate attendance; leave immediately removes the public listing',
  )
  unwrap(
    await clients[0]
      .from('profiles')
      .update({
        decoration_id: 'avatar-air',
        call_background_id: 'barbie-coral',
      })
      .eq('id', users[0].id),
    'Save cosmetics',
  )
  const cosmetics = unwrap(
    await clients[1].rpc('get_profile_cosmetics', {
      p_user_ids: [users[0].id],
    }),
    'Read cosmetics',
  )
  assert.equal(cosmetics[0].decoration_id, 'avatar-air')
  assert.equal(cosmetics[0].call_background_id, 'barbie-coral')
  assert.equal(
    (
      await clients[0]
        .from('profiles')
        .update({ decoration_id: 'https://external.invalid/tracker' })
        .eq('id', users[0].id)
    ).error?.code,
    '23514',
  )
  console.log(
    'PASS: curated cosmetics persist and reach other users; arbitrary URLs are rejected',
  )
} finally {
  const cleanupErrors = []
  for (const code of codes) {
    const { error } = await admin.from('call_rooms').delete().eq('code', code)
    if (error) cleanupErrors.push(`room: ${error.code || error.name}`)
  }
  for (const c of clients) {
    try { await c.auth.signOut() } catch { /* Deleting the QA account invalidates its session too. */ }
  }
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) cleanupErrors.push(`account: ${error.code || error.name}`)
  }
  assert.equal(cleanupErrors.length, 0, `QA cleanup failed: ${cleanupErrors.join(', ')}`)
  console.log(
    `CLEANUP: ${users.length} QA accounts and ${codes.length} QA rooms removed`,
  )
}
