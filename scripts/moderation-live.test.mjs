// Opt-in production-bound auth checks. No real owner session or real call is used.
// Only a temporary member is created, then deleted in finally. Keys stay in memory.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--linked'))
  throw new Error('Use --linked to opt in to the linked Supabase auth checks')
const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
assert.match(ref, /^[a-z]{20}$/)
const result = spawnSync(
  fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url)),
  ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'],
  { encoding: 'utf8' },
)
assert.equal(result.status, 0, 'Supabase CLI must be authenticated')
const keys = JSON.parse(result.stdout)
const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key
const publicKey =
  keys.find((key) => key.type === 'publishable')?.api_key || keys.find((key) => key.name === 'anon')?.api_key
assert.ok(serviceKey && publicKey)
const url = `https://${ref}.supabase.co`
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, serviceKey, options)
const client = createClient(url, publicKey, options)
const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.code || error.name)
  return data
}
const request = async (token) => {
  const response = await fetch(`${url}/functions/v1/admin`, {
    method: 'POST',
    headers: {
      apikey: publicKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action: 'disconnect_participant',
      roomCode: `QA-${randomUUID()}`,
      userId: randomUUID(),
      participantSid: 'PA_fakeTestOnly',
      role: 'owner',
      owner: true,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  return { status: response.status, body: await response.json() }
}
let temporaryUser
try {
  const anonymous = await request()
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.error, 'AUTH_REQUIRED')
  console.log('PASS: deployed API rejects unauthenticated removal')
  const invalid = await request('invalid-qa-token')
  assert.equal(invalid.status, 401)
  console.log('PASS: deployed API rejects forged sessions')
  const email = `fordkall-moderation-qa-${randomUUID()}@example.invalid`
  const password = randomBytes(32).toString('base64url')
  temporaryUser = unwrap(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'owner' },
    }),
  ).user
  const profile = unwrap(
    await admin.from('profiles').select('role,status').eq('id', temporaryUser.id).single(),
  )
  assert.equal(profile.role, 'member')
  const auth = unwrap(await client.auth.signInWithPassword({ email, password }))
  const member = await request(auth.session.access_token)
  assert.equal(member.status, 403)
  assert.ok(['ADMIN_REQUIRED', 'OWNER_REQUIRED'].includes(member.body.error))
  console.log('PASS: a real member named owner cannot disconnect, even with forged role fields')
  const audit = unwrap(await admin.from('admin_audit_log').select('id').eq('actor_id', temporaryUser.id))
  assert.equal(audit.length, 0)
  console.log('PASS: denied requests do not perform a moderation action')
} finally {
  await client.auth.signOut()
  if (temporaryUser) {
    unwrap(await admin.auth.admin.deleteUser(temporaryUser.id))
    console.log('CLEANUP: temporary member deleted; no owner account or real call was touched')
  }
}
