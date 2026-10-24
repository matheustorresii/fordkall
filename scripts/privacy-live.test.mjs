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
  if (process.argv.includes('--sessions')) {
    unwrap(await clients[2].from('social_preferences').upsert({ user_id: users[2].id, do_not_disturb: true }), 'Enable QA DND')
    assert.ok((await clients[0].rpc('start_direct_call', { p_recipient: users[2].id, p_room_code: privateCode })).error?.message.includes('CALL_DO_NOT_DISTURB'))
    unwrap(await clients[2].from('social_preferences').update({ do_not_disturb: false }).eq('user_id', users[2].id), 'Disable QA DND')
    let incomingResolve
    const delivered = new Promise(resolve => { incomingResolve = resolve })
    const channel = clients[2].channel(`qa-calls-${run}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_calls', filter: `recipient_id=eq.${users[2].id}` }, payload => incomingResolve(payload.new))
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('QA realtime subscription timed out')), 15000)
        channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() } })
      })
      const invitation = unwrap(await clients[0].rpc('start_direct_call', { p_recipient: users[2].id, p_room_code: privateCode }), 'Create private QA call')
      const timer = setTimeout(() => incomingResolve(null), 15000)
      const incoming = await delivered
      clearTimeout(timer)
      assert.equal(incoming?.id, invitation.id, 'Recipient must actually receive the realtime call')
      assert.equal(incoming.room_code, privateCode)
      assert.deepEqual(unwrap(await clients[1].from('direct_calls').select('id').eq('id', invitation.id), 'Outsider call RLS'), [])
      assert.ok((await clients[1].rpc('respond_direct_call', { p_call_id: invitation.id, p_action: 'accept' })).error)
      assert.equal(unwrap(await clients[2].rpc('respond_direct_call', { p_call_id: invitation.id, p_action: 'accept' }), 'Accept QA call').status, 'accepted')
      assert.ok((await clients[2].rpc('respond_direct_call', { p_call_id: invitation.id, p_action: 'accept' })).error?.message.includes('CALL_ALREADY_ANSWERED'))
      unwrap(await clients[2].rpc('respond_direct_call', { p_call_id: invitation.id, p_action: 'end' }), 'End QA call')
    } finally { await clients[2].removeChannel(channel) }
    console.log('PASS: real realtime incoming call, participant-only visibility, DND, acceptance and multi-device race protection')
    const topic = 'ford-kall.poker.v2', sessionA = randomUUID(), sessionB = randomUUID()
    const lease = unwrap(await clients[0].rpc('claim_game_checkpoint', { p_room: privateCode, p_topic: topic, p_session: sessionA }), 'Claim QA game')
    assert.equal(lease.owns, true)
    const publicState = { gameId: 'qa-hand', revision: 1, controllerIdentity: users[0].id, players: [], chips: 2000 }
    const privateState = { secrets: { [users[0].id]: ['AS', 'AH'], [users[1].id]: ['KS', 'KH'] }, authority: { deck: ['2S', '2H'] } }
    unwrap(await clients[0].rpc('save_game_checkpoint', { p_room: privateCode, p_topic: topic, p_session: sessionA, p_epoch: lease.epoch, p_state: publicState, p_private: privateState }), 'Save QA game')
    const peer = unwrap(await clients[1].rpc('list_game_checkpoints', { p_room: privateCode, p_session: sessionB }), 'Read own QA hand').find(row => row.topic === topic)
    assert.equal(peer.payload, null); assert.deepEqual(peer.ownPrivate, ['KS', 'KH'])
    assert.ok((await clients[2].rpc('list_game_checkpoints', { p_room: privateCode, p_session: randomUUID() })).error)
    assert.ok((await clients[1].from('room_game_checkpoints').select('*')).error)
    const busy = unwrap(await clients[1].rpc('claim_game_checkpoint', { p_room: privateCode, p_topic: topic, p_session: sessionB }), 'Try live QA lease')
    assert.equal(busy.owns, false); assert.equal(busy.payload, null)
    unwrap(await admin.from('room_game_checkpoints').update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq('room_code', privateCode).eq('topic', topic), 'Expire only QA lease')
    const takeover = unwrap(await clients[1].rpc('claim_game_checkpoint', { p_room: privateCode, p_topic: topic, p_session: sessionB }), 'Take over QA lease')
    assert.equal(takeover.owns, true); assert.equal(takeover.epoch, lease.epoch + 1); assert.deepEqual(takeover.payload.authority, privateState.authority)
    assert.ok((await clients[0].rpc('save_game_checkpoint', { p_room: privateCode, p_topic: topic, p_session: sessionA, p_epoch: lease.epoch, p_state: { ...publicState, revision: 2 }, p_private: privateState })).error?.message.includes('GAME_LEASE_LOST'))
    console.log('PASS: deployed private checkpoint persistence, own-hand recovery, room membership, fenced takeover and stale writer rejection')
  }
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
    const route = await admin.from('livekit_room_routes').delete().eq('room_name', code)
    if (route.error) cleanupErrors.push(`QA route: ${route.error.code || route.error.name}`)
  }
  for (const c of clients) {
    try { await c.auth.signOut() } catch { /* Deleting the QA account invalidates its session too. */ }
    await c.removeAllChannels()
    c.realtime.disconnect()
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
