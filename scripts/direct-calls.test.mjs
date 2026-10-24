import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isRinging,
  callError,
  directCallLabel,
} from '../src/services/directCallsPolicy.ts'
const base = {
  caller_id: 'a',
  recipient_id: 'b',
  status: 'ringing',
  expires_at: '2026-10-24T12:00:45Z',
}
test('ringing has a hard expiry; accepted/cancelled calls never keep ringing', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')
  assert.ok(isRinging(base, now))
  assert.equal(isRinging(base, now + 45000), false)
  for (const status of [
    'accepted',
    'cancelled',
    'missed',
    'declined',
    'ended',
    'busy',
  ])
    assert.equal(isRinging({ ...base, status }, now), false)
})
test('calling/receiving labels are per-account and terminal states are distinct', () => {
  assert.equal(directCallLabel(base, 'a'), 'Chamando…')
  assert.equal(directCallLabel(base, 'b'), 'Chamada recebida')
  assert.notEqual(
    directCallLabel({ ...base, status: 'missed' }, 'a'),
    directCallLabel({ ...base, status: 'declined' }, 'a'),
  )
})
test('DND, busy, throttling and already-answered errors explain the actual outcome', () => {
  for (const [code, pattern] of [
    ['CALL_DO_NOT_DISTURB', /perturbe/],
    ['CALL_BUSY', /chamada/],
    ['CALL_RATE_LIMIT', /Aguarde/],
    ['CALL_ALREADY_ANSWERED', /dispositivo/],
  ])
    assert.match(callError({ message: code }), pattern)
  assert.ok(!callError(Error('SECRET token')).includes('SECRET'))
})
