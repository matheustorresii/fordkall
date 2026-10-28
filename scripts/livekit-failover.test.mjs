import test from 'node:test'
import assert from 'node:assert/strict'
import {
  admitIssuedConnection,
  AdmissionFailure,
  classifyAdmission,
  failureDecision,
  inspectRoomOccupancy,
  normalizeFailedBackends,
  probeLiveKitAdmission,
} from '../supabase/functions/_shared/livekitFailover.ts'
import {
  connectionFailureMessage,
  connectionFailureStatus,
} from '../src/services/connectionPolicy.ts'

test('an administrative API answering is not proof that RTC admission works', () => {
  const admission = classifyAdmission(402, 'monthly quota exhausted')
  assert.deepEqual(failureDecision(admission, 'empty', true), {
    code: 'QUOTA_EXCEEDED',
    markBackendFailed: true,
    preserveRoom: false,
  })
})
test('a token broker returning 200 and a valid JWT cannot bypass the same admission check as direct projects', async () => {
  for (const kind of ['sandbox', 'direct']) {
    const issued = {
      serverUrl: 'wss://server.invalid',
      participantToken: `SECRET_${kind}`,
    }
    await assert.rejects(
      admitIssuedConnection(
        issued,
        async () =>
          new Response('connection minutes limit exceeded', { status: 429 }),
      ),
      (error) =>
        error instanceof AdmissionFailure &&
        error.admission.code === 'QUOTA_EXCEEDED',
    )
  }
})
test('quota, credentials, region restriction, unavailable and unsupported validation stay distinct', () => {
  for (const [status, text, code] of [
    [200, 'success', 'OK'],
    [429, 'limit reached', 'QUOTA_EXCEEDED'],
    [403, 'participant limit exceeded', 'QUOTA_EXCEEDED'],
    [401, 'invalid token', 'AUTH_REJECTED'],
    [403, 'project is not allowed in this region', 'REGION_UNAVAILABLE'],
    [503, 'unavailable', 'BACKEND_UNAVAILABLE'],
    [404, 'no route', 'VALIDATION_UNAVAILABLE'],
  ])
    assert.equal(classifyAdmission(status, text).code, code)
})
test('preflight uses an authorization header, never a signed query URL, and opens no WebSocket', async () => {
  let count = 0
  const result = await probeLiveKitAdmission(
    'wss://server.invalid/',
    'SECRET_TOKEN',
    async (url, init) => {
      count++
      assert.equal(url.protocol, 'https:')
      assert.equal(url.pathname, '/rtc/v1')
      assert.ok(!String(url).includes('SECRET_TOKEN'))
      assert.equal(init.headers.Authorization, 'Bearer SECRET_TOKEN')
      assert.equal(init.redirect, 'manual')
      assert.ok(init.signal)
      return new Response('quota limit exceeded SECRET_UPSTREAM', {
        status: 403,
      })
    },
  )
  assert.equal(count, 1)
  assert.equal(result.code, 'QUOTA_EXCEEDED')
  assert.ok(!JSON.stringify(result).includes('SECRET'))
})
test('a healthy /validate cannot hide a 429 on the actual RTC gateway', async () => {
  const paths = []
  const result = await probeLiveKitAdmission(
    'wss://server.invalid',
    'SECRET',
    async (url) => {
      paths.push(url.pathname)
      return new Response(
        url.pathname === '/rtc/v1' ? 'limit reached' : 'success',
        { status: url.pathname === '/rtc/v1' ? 429 : 200 },
      )
    },
  )
  assert.equal(result.code, 'QUOTA_EXCEEDED')
  assert.deepEqual(paths, ['/rtc/v1'])
})
test('the normal RTC 404 without an Upgrade falls through to authenticated validation without opening a session', async () => {
  const paths = []
  const result = await probeLiveKitAdmission(
    'wss://server.invalid',
    'SECRET',
    async (url, init) => {
      paths.push(url.pathname)
      assert.equal(init.headers.Upgrade, undefined)
      return new Response(url.pathname === '/rtc/v1' ? '' : 'success', {
        status: url.pathname === '/rtc/v1' ? 404 : 200,
      })
    },
  )
  assert.equal(result.code, 'OK')
  assert.deepEqual(paths, ['/rtc/v1', '/rtc/validate'])
})
test('a timeout is bounded and never propagates a URL, token or upstream body', async () => {
  const result = await probeLiveKitAdmission(
    'wss://server.invalid',
    'SECRET',
    async () => {
      throw Error('https://SECRET')
    },
  )
  assert.deepEqual(result, {
    ok: false,
    code: 'BACKEND_UNAVAILABLE',
    httpStatus: null,
  })
})
test('an occupied room never moves, even if it cannot accept another participant', () => {
  for (const status of [402, 403, 429, 503])
    assert.ok(
      failureDecision(classifyAdmission(status, ''), 'occupied', true)
        .preserveRoom,
    )
})
test('uncertain occupancy preserves a confirmed room instead of splitting the call', () => {
  assert.ok(
    failureDecision(classifyAdmission(503, ''), 'unknown', true).preserveRoom,
  )
  assert.equal(
    failureDecision(classifyAdmission(503, ''), 'unknown', false).preserveRoom,
    false,
  )
})
test('client-only network errors do not globally poison a healthy project', () => {
  const decision = failureDecision(
    classifyAdmission(200, 'success'),
    'empty',
    false,
  )
  assert.equal(decision.markBackendFailed, false)
  assert.equal(decision.code, 'CLIENT_SIGNAL_FAILED')
  assert.equal(decision.preserveRoom, false)
})
test('unsupported preflight does not disable older/self-hosted servers', () => {
  assert.equal(
    failureDecision(classifyAdmission(404, 'no route'), 'empty', false)
      .markBackendFailed,
    false,
  )
})
test('a server-side probe in another region cannot globally disable a region-pinned project', () => {
  assert.equal(
    failureDecision(
      classifyAdmission(403, 'project is not allowed in this region'),
      'empty',
      false,
    ).markBackendFailed,
    false,
  )
})
test('only an explicit room-not-found error counts as an empty room', async () => {
  assert.equal(await inspectRoomOccupancy(async () => []), 'empty')
  assert.equal(await inspectRoomOccupancy(async () => [{}]), 'occupied')
  assert.equal(
    await inspectRoomOccupancy(async () => {
      throw { code: 'not_found', message: 'room does not exist' }
    }),
    'empty',
  )
  assert.equal(
    await inspectRoomOccupancy(async () => {
      throw { status: 404, message: 'proxy not found' }
    }),
    'unknown',
  )
  assert.equal(
    await inspectRoomOccupancy(async () => new Promise(() => {}), 5),
    'unknown',
  )
})
test('failed projects are unique, bounded and selected only from the configured pool', () => {
  assert.deepEqual(
    normalizeFailedBackends(
      ['a', 'a', 'b', 'SECRET', null, 1],
      ['a', 'b', 'c'],
    ),
    ['a', 'b'],
  )
  assert.deepEqual(normalizeFailedBackends('a', ['a']), [])
  assert.deepEqual(normalizeFailedBackends(['a', 'b', 'c'], ['a', 'b', 'c']), [
    'a',
    'b',
    'c',
  ])
})
test('pool outage and a local network issue have honest, actionable messages without claiming quota exhaustion', () => {
  assert.match(
    connectionFailureMessage('LIVEKIT_POOL_UNAVAILABLE'),
    /podem estar sem cota/,
  )
  assert.match(
    connectionFailureMessage('LIVEKIT_CLIENT_CONNECTION_FAILED'),
    /VPN ou firewall/,
  )
  assert.match(
    connectionFailureMessage('LIVEKIT_ROOM_UNAVAILABLE'),
    /não separar/,
  )
  assert.equal(connectionFailureMessage('SECRET raw token'), null)
  assert.equal(connectionFailureStatus({ context: { status: 429 } }), 429)
  assert.equal(connectionFailureStatus({ status: 'SECRET' }), null)
})
