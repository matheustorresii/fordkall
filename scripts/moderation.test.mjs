import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import {
  disconnectRoomParticipant,
  moderationBackendForRoute,
} from '../supabase/functions/_shared/roomModeration.ts'

const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'owner', status: 'active' }
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const body = { roomCode: 'kiwi-123', userId: targetId, participantSid: 'PA_target123' }
const missing = () => Object.assign(new Error('not found'), { code: 'not_found' })
const setup = () => {
  const calls = [],
    audits = []
  const service = {
    getParticipant: async (room, identity) => {
      calls.push(['get', room, identity])
      return { identity, sid: identity === owner.id ? 'PA_owner123' : body.participantSid }
    },
    removeParticipant: async (room, identity) => {
      calls.push(['remove', room, identity])
    },
  }
  const dependencies = {
    getRoomService: async (room) => {
      calls.push(['route', room])
      return { backendId: 'reserve-2', service }
    },
    audit: async (event) => {
      audits.push(event)
    },
  }
  return { calls, audits, service, dependencies }
}
const denied = (status, message) => (error) => error.status === status && error.message === message

test('owner ativo desconecta somente o alvo da sala roteada e registra auditoria', async () => {
  const s = setup()
  assert.deepEqual(await disconnectRoomParticipant(owner, body, s.dependencies), { ok: true })
  assert.deepEqual(s.calls, [
    ['route', 'KIWI-123'],
    ['get', 'KIWI-123', owner.id],
    ['get', 'KIWI-123', targetId],
    ['remove', 'KIWI-123', targetId],
  ])
  assert.deepEqual(s.audits, [
    {
      actorId: owner.id,
      userId: targetId,
      roomName: 'KIWI-123',
      participantSid: body.participantSid,
      backendId: 'reserve-2',
    },
  ])
})
test('member, admin, papel desconhecido e owner suspenso são recusados antes de consultar a sala', async () => {
  for (const actor of [
    { ...owner, role: 'member' },
    { ...owner, role: 'admin' },
    { ...owner, role: 'OWNER' },
    { ...owner, role: '' },
    { ...owner, status: 'suspended' },
  ]) {
    const s = setup()
    await assert.rejects(
      disconnectRoomParticipant(actor, { ...body, role: 'owner', name: 'owner' }, s.dependencies),
      denied(403, 'OWNER_REQUIRED'),
    )
    assert.deepEqual(s.calls, [])
  }
})
test('nome, metadata e owner forjados na requisição não concedem privilégio', async () => {
  const s = setup()
  await assert.rejects(
    disconnectRoomParticipant(
      { ...owner, role: 'member' },
      {
        ...body,
        owner: true,
        metadata: { fordKallAccount: { role: 'owner' } },
      },
      s.dependencies,
    ),
    denied(403, 'OWNER_REQUIRED'),
  )
  assert.deepEqual(s.calls, [])
})
test('parâmetros inválidos e tentativa de auto-desconexão não chegam ao LiveKit', async () => {
  for (const patch of [
    { roomCode: undefined },
    { roomCode: 123 },
    { roomCode: '' },
    { roomCode: 'a'.repeat(65) },
    { roomCode: 'a'.repeat(129) },
    { userId: 'nome-qualquer' },
    { userId: owner.id.toUpperCase() },
    { userId: null },
    { participantSid: undefined },
    { participantSid: '' },
    { participantSid: 'PA_\n123' },
  ]) {
    const s = setup()
    await assert.rejects(
      disconnectRoomParticipant(owner, { ...body, ...patch }, s.dependencies),
      (e) => e.status === 400,
    )
    assert.deepEqual(s.calls, [])
    assert.deepEqual(s.audits, [])
  }
})
test('rotação: utiliza exatamente o backend persistido da sala, nunca a primeira credencial ou URL do client', () => {
  const first = {
    id: 'primary',
    kind: 'direct',
    url: 'wss://first.invalid',
    apiKey: 'fake-key',
    apiSecret: 'fake-secret',
    label: 'First',
  }
  const reserve = { ...first, id: 'reserve-2', url: 'wss://second.invalid' }
  assert.equal(moderationBackendForRoute([first, reserve], 'reserve-2'), reserve)
  for (const id of [null, 'missing', 'wss://client.invalid'])
    assert.throws(
      () => moderationBackendForRoute([first, reserve], id),
      denied(503, 'CALL_MODERATION_UNAVAILABLE'),
    )
  assert.throws(
    () =>
      moderationBackendForRoute(
        [{ id: 'sandbox', kind: 'sandbox', sandboxId: 'fake', label: 'Sandbox' }],
        'sandbox',
      ),
    denied(503, 'CALL_MODERATION_UNAVAILABLE'),
  )
})
test('owner precisa estar na mesma sala; estar em outra não permite remover o alvo', async () => {
  const s = setup()
  s.service.getParticipant = async (_room, id) => {
    if (id === owner.id) throw missing()
    return { identity: id, sid: body.participantSid }
  }
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(403, 'OWNER_NOT_IN_ROOM'),
  )
  assert.ok(!s.calls.some(([action]) => action === 'remove'))
  assert.equal(s.audits.length, 0)
})
test('resposta de uma identidade diferente não é aceita como presença do owner', async () => {
  const s = setup()
  s.service.getParticipant = async () => ({ identity: targetId, sid: body.participantSid })
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(403, 'OWNER_NOT_IN_ROOM'),
  )
})
test('pessoa que já saiu não é removida novamente', async () => {
  const s = setup(),
    original = s.service.getParticipant
  s.service.getParticipant = async (room, id) => {
    if (id === targetId) throw missing()
    return original(room, id)
  }
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(404, 'PARTICIPANT_NOT_IN_ROOM'),
  )
  assert.ok(!s.calls.some(([action]) => action === 'remove'))
})
test('confirmação de uma sessão antiga é recusada se o participante reconectou', async () => {
  const s = setup(),
    original = s.service.getParticipant
  s.service.getParticipant = async (room, id) =>
    id === targetId ? { identity: id, sid: 'PA_newSession' } : original(room, id)
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(409, 'PARTICIPANT_CHANGED'),
  )
  assert.ok(!s.calls.some(([action]) => action === 'remove'))
})
test('resposta de alvo diferente também é recusada, mesmo com SID igual', async () => {
  const s = setup(),
    original = s.service.getParticipant
  s.service.getParticipant = async (room, id) =>
    id === targetId ? { identity: owner.id, sid: body.participantSid } : original(room, id)
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(409, 'PARTICIPANT_CHANGED'),
  )
})
test('falhas de consulta ou remoção não devolvem erro interno/credenciais ao client nem geram sucesso', async () => {
  for (const operation of ['getParticipant', 'removeParticipant']) {
    const s = setup()
    s.service[operation] = async () => {
      throw Object.assign(new Error('Sensitive provider diagnostics'), { code: 'unavailable' })
    }
    await assert.rejects(
      disconnectRoomParticipant(owner, body, s.dependencies),
      denied(503, 'CALL_MODERATION_UNAVAILABLE'),
    )
    assert.deepEqual(s.audits, [])
  }
})
test('saída entre a confirmação e a API de remoção retorna erro claro, sem sucesso falso', async () => {
  const s = setup()
  s.service.removeParticipant = async () => {
    throw missing()
  }
  await assert.rejects(
    disconnectRoomParticipant(owner, body, s.dependencies),
    denied(404, 'PARTICIPANT_NOT_IN_ROOM'),
  )
  assert.deepEqual(s.audits, [])
})
test('falha isolada da auditoria não mascara uma desconexão já realizada', async () => {
  const s = setup()
  s.dependencies.audit = async () => {
    throw new Error('DB unavailable')
  }
  const log = mock.method(console, 'error', () => {})
  try {
    assert.deepEqual(await disconnectRoomParticipant(owner, body, s.dependencies), { ok: true })
    assert.equal(s.calls.filter(([action]) => action === 'remove').length, 1)
    assert.deepEqual(log.mock.calls[0].arguments, ['CALL_DISCONNECT_AUDIT_FAILED'])
  } finally {
    log.mock.restore()
  }
})
