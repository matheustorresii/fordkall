// Explicit opt-in integration test against the linked Supabase project.
// Uses three temporary accounts, never reads a real user's inbox, and deletes
// its own accounts/messages in finally. API keys stay in memory, not in logs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--linked')) {
  throw new Error('This live test requires explicit opt-in: npm run test:social:live -- --linked')
}

const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
assert.match(ref, /^[a-z]{20}$/)
const result = spawnSync(fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url)), [
  'projects', 'api-keys', '--project-ref', ref, '--output', 'json',
], { encoding: 'utf8' })
assert.equal(result.status, 0, 'Supabase CLI must be signed in to the linked project')
const keys = JSON.parse(result.stdout)
const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key
const publicKey = keys.find((key) => key.type === 'publishable')?.api_key
  || keys.find((key) => key.name === 'anon')?.api_key
assert.ok(serviceKey && publicKey, 'Linked project keys must be available')
const url = `https://${ref}.supabase.co`
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
}
const admin = createClient(url, serviceKey, options)
const clients = []
const users = []
const run = randomUUID()
const password = randomBytes(32).toString('base64url')
const unwrap = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.code || error.name || 'request failed'}`)
  return data
}
const withTimeout = (promise, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout`)), 15_000) }),
  ]).finally(() => clearTimeout(timer))
}
const login = async (user) => {
  const client = createClient(url, publicKey, options)
  clients.push(client)
  const auth = unwrap(await client.auth.signInWithPassword({ email: user.email, password }), 'Sign in')
  await client.realtime.setAuth(auth.session.access_token)
  return client
}

try {
  for (let index = 0; index < 3; index++) {
    const { user } = unwrap(await admin.auth.admin.createUser({
      email: `fordkall-dm-qa-${run}-${index}@example.invalid`,
      password,
      email_confirm: true,
      user_metadata: { display_name: `DM integration QA ${index + 1}` },
    }), 'Create temporary QA account')
    users.push(user)
  }
  const [sender, recipient, outsider] = await Promise.all(users.map(login))
  console.log('QA: three temporary accounts signed in')
  const [low, high] = [users[0].id, users[1].id].sort()
  const pair = { user_low: low, user_high: high }
  const onlineId = randomUUID()
  const offlineId = randomUUID()
  let resolveDelivery
  const delivery = new Promise((resolve) => { resolveDelivery = resolve })
  const channel = recipient.channel(`fk:dm-qa:${run}`)
    .on('system', {}, (payload) => {
      if (payload.status === 'error') console.log('QA realtime error:', payload.message)
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
      if (payload.new.id === onlineId) resolveDelivery(payload.new)
    })
  await withTimeout(new Promise((resolve, reject) => channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolve()
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`Realtime: ${status}`))
  })), 'Subscribe to recipient inbox')
  console.log('QA: recipient inbox subscribed')

  const online = unwrap(await sender.from('direct_messages').insert({
    id: onlineId, ...pair, sender_id: users[0].id, body: 'Online delivery QA',
  }).select('id,user_low,user_high,sender_id,body,created_at,read_at').single(), 'Send to online recipient')
  assert.equal(online.id, onlineId)
  console.log('QA: DM accepted by the public API')
  assert.equal((await withTimeout(delivery, 'Realtime delivery')).body, 'Online delivery QA')
  console.log('PASS: online recipient receives the inserted DM over the real realtime connection')

  await recipient.removeChannel(channel)
  unwrap(await recipient.auth.signOut(), 'Disconnect recipient')
  unwrap(await sender.from('direct_messages').insert({
    id: offlineId, ...pair, sender_id: users[0].id, body: 'Offline delivery QA',
  }).select('id').single(), 'Send to offline recipient')
  const returning = await login(users[1])
  const history = unwrap(await returning.from('direct_messages')
    .select('id,sender_id,body,created_at,read_at')
    .eq('user_low', low).eq('user_high', high)
    .order('created_at', { ascending: false }).limit(100), 'Load history after login')
  assert.equal(history.length, 2)
  assert.ok(history.some((message) => message.id === offlineId && !message.read_at))
  console.log('PASS: offline DM persists and is available in a new authenticated session')

  const profiles = unwrap(await returning.rpc('get_social_profile_cards', {
    p_user_ids: [users[0].id], p_include_avatar: false,
  }), 'Hydrate sender profile')
  assert.equal(profiles[0].id, users[0].id)
  const marked = unwrap(await returning.from('direct_messages')
    .update({ read_at: new Date().toISOString() }).eq('user_low', low).eq('user_high', high)
    .neq('sender_id', users[1].id).is('read_at', null).select('id'), 'Mark messages as read')
  assert.equal(marked.length, 2)
  unwrap(await returning.from('direct_messages').insert({
    ...pair, sender_id: users[1].id, body: 'Reply QA',
  }).select('id').single(), 'Reply from recipient')
  console.log('PASS: sender profile hydration, read receipts and replies work through the public API')

  const forbidden = unwrap(await outsider.from('direct_messages').select('id')
    .eq('user_low', low).eq('user_high', high), 'Check third-party access')
  assert.equal(forbidden.length, 0)
  const spoof = await sender.from('direct_messages').insert({
    ...pair, sender_id: users[1].id, body: 'Spoof attempt QA',
  })
  assert.equal(spoof.error?.code, '42501')
  console.log('PASS: a third account cannot read the conversation, and sender spoofing is rejected')
} finally {
  await Promise.allSettled(clients.map(async (client) => {
    await client.removeAllChannels()
    await client.auth.signOut()
  }))
  const cleanupErrors = []
  let deleted = 0
  for (const user of users) {
    try {
      unwrap(await admin.auth.admin.deleteUser(user.id), 'Remove temporary QA account and its messages')
      deleted++
    } catch (error) { cleanupErrors.push(error) }
  }
  await admin.removeAllChannels()
  console.log(`CLEANUP: ${deleted}/${users.length} temporary accounts and their messages deleted`)
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'QA account cleanup must be completed')
}
