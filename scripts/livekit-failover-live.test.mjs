// Opt-in smoke test. One disposable account/private room; no WebSocket, media or real-user calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import https from 'node:https'
import { gzipSync } from 'node:zlib'
import {
  ClientInfo,
  ClientInfo_SDK,
  ConnectionSettings,
  JoinRequest,
  WrappedJoinRequest,
  WrappedJoinRequest_Compression,
} from '@livekit/protocol'
import { classifyAdmission } from '../supabase/functions/_shared/livekitFailover.ts'
if (!process.argv.includes('--linked'))
  throw Error('Use --linked to authorize the disposable production smoke test')
const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
const result = spawnSync(
  'node_modules/.bin/supabase',
  ['projects', 'api-keys', '--project-ref', ref, '--output', 'json'],
  { encoding: 'utf8' },
)
assert.equal(result.status, 0, 'Could not read existing project credentials')
const keys = JSON.parse(result.stdout)
const service = keys.find((key) => key.name === 'service_role')?.api_key
const publishable =
  keys.find((key) => key.type === 'publishable')?.api_key ||
  keys.find((key) => key.name === 'anon')?.api_key
assert.ok(service && publishable)
const url = `https://${ref}.supabase.co`
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(45000) }),
  },
}
const admin = createClient(url, service, options),
  client = createClient(url, publishable, options)
const id = randomUUID(),
  code = `QA-FAILOVER-${id.slice(0, 8).toUpperCase()}`,
  password = randomBytes(32).toString('base64url')
let user
async function signaling(details) {
  const url = new URL(details.serverUrl.replace(/^wss:/, 'https:'))
  url.pathname = '/rtc/v1'
  url.searchParams.set('access_token', details.participantToken)
  const join = new JoinRequest({
    clientInfo: new ClientInfo({
      sdk: ClientInfo_SDK.JS,
      version: '2.22.0',
      protocol: 17,
    }),
    connectionSettings: new ConnectionSettings({ autoSubscribe: false }),
  })
  const wrapped = new WrappedJoinRequest({
    joinRequest: gzipSync(join.toBinary()),
    compression: WrappedJoinRequest_Compression.GZIP,
  })
  url.searchParams.set(
    'join_request',
    Buffer.from(wrapped.toBinary()).toString('base64url'),
  )
  const plain = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  console.log(
    'QA RTC gateway without WebSocket upgrade:',
    JSON.stringify(classifyAdmission(plain.status, await plain.text())),
  )
  const headerUrl = new URL(url)
  headerUrl.search = ''
  const header = await fetch(headerUrl, {
    headers: { Authorization: `Bearer ${details.participantToken}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  const headerText = await header.text()
  console.log(
    'QA RTC gateway with header-only auth:',
    JSON.stringify({
      ...classifyAdmission(header.status, headerText),
      reason: headerText
        .replace(/(?:https?|wss?):\/\/\S+/gi, '[url]')
        .replace(/[A-Za-z0-9_=-]{24,}/g, '[redacted]')
        .slice(0, 500),
      retryAfter: header.headers.get('retry-after'),
    }),
  )
  return new Promise((resolve) => {
    const req = https.request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    })
    req.on('upgrade', (response, socket) => {
      socket.destroy()
      resolve({ status: response.statusCode, code: 'WEBSOCKET_ACCEPTED' })
    })
    req.on('response', (response) => {
      let text = ''
      response.on('data', (chunk) => {
        if (text.length < 4096) text += chunk.toString()
      })
      response.on('end', () => {
        const result = classifyAdmission(response.statusCode, text)
        resolve({ status: result.httpStatus, code: result.code })
      })
    })
    req.on('error', () => resolve({ status: null, code: 'NETWORK_FAILED' }))
    req.setTimeout(15000, () => req.destroy())
    req.end()
  })
}
try {
  const created = await admin.auth.admin.createUser({
    email: `fk-failover-${id}@example.invalid`,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Failover QA' },
  })
  assert.ok(!created.error, 'Could not create disposable QA account')
  user = created.data.user
  const login = await client.auth.signInWithPassword({
    email: user.email,
    password,
  })
  assert.ok(!login.error, 'Could not sign in QA account')
  const response = await client.functions.invoke('livekit-token', {
    body: { roomCode: code, privateRoom: true },
  })
  if (response.error) {
    const payload = await response.error.context?.json()
    assert.equal(response.error.context?.status, 503)
    assert.equal(payload?.error, 'LIVEKIT_POOL_UNAVAILABLE')
    console.log(
      'PASS: deployed token function returns explicit 503 LIVEKIT_POOL_UNAVAILABLE instead of a generic 500 when no project permits entry',
    )
  } else {
    assert.ok(
      response.data?.participantToken &&
        response.data?.serverUrl &&
        response.data?.backendId,
    )
    assert.equal(response.data.privateRoom, true)
    console.log(
      'QA deployed admission policy:',
      JSON.stringify({
        policy: response.data.admissionPolicy,
        admission: response.data.admission,
      }),
    )
    console.log(
      `PASS: deployed admission check produced a join token on ${response.data.backendId}; no media session was opened`,
    )
    if (process.argv.includes('--signaling')) {
      for (const size of [0, 7000, 19000]) {
        assert.ok(
          !(
            await admin
              .from('profiles')
              .update({
                avatar_data_url: size
                  ? `data:image/png;base64,${'A'.repeat(size)}`
                  : null,
              })
              .eq('id', user.id)
          ).error,
        )
        const attempt = size
          ? await client.functions.invoke('livekit-token', {
              body: { roomCode: code, privateRoom: true },
            })
          : response
        assert.ok(!attempt.error, 'QA token request failed; details withheld')
        console.log(
          'QA signaling (synthetic profile, no audio/video):',
          JSON.stringify({
            avatarChars: size,
            tokenChars: attempt.data.participantToken.length,
            ...(await signaling(attempt.data)),
          }),
        )
      }
    }
  }
  const attempts = await admin
    .from('livekit_token_issuances')
    .select('backend_id,connection_error_code,connection_http_status')
    .eq('user_id', user.id)
    .eq('room_name', code)
  assert.ok(!attempts.error)
  console.log('QA admission diagnostics:', JSON.stringify(attempts.data))
  const anonymous = await fetch(`${url}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: { apikey: publishable, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: code }),
  })
  assert.equal(anonymous.status, 401)
  console.log('PASS: anonymous requests remain rejected')
} finally {
  const routes = await admin
    .from('livekit_room_routes')
    .delete()
    .eq('room_name', code)
  const room = await admin.from('call_rooms').delete().eq('code', code)
  assert.ok(!routes.error && !room.error, 'QA room cleanup failed')
  if (user)
    assert.ok(
      !(await admin.auth.admin.deleteUser(user.id)).error,
      'QA account cleanup failed',
    )
  console.log('CLEANUP: disposable QA account and private room removed')
}
