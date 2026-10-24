import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GameRecoveryCoordinator,
  shiftGameDeadlines,
  GAME_RECONNECT_GRACE_MS,
} from '../src/games/recovery.ts'
const topic = 'ford-kall.poker.v2'
const clone = (value) => structuredClone(value)
function fixture() {
  let now = 1_000_000,
    connected = ['a', 'b'],
    failSave = false
  const rows = new Map(),
    events = []
  const rpc = (identity) => async (name, args) => {
    const row = rows.get(args.p_topic)
    const view = (row) => ({
      ...clone(row),
      serverNow: new Date(now).toISOString(),
      clockAt: row.payload?.clockAt,
      owns: row.owner === identity && row.session === args.p_session,
      payload:
        row.owner === identity && row.session === args.p_session
          ? clone(row.payload)
          : null,
      ownPrivate: clone(row.payload?.secrets?.[identity]),
    })
    if (name === 'list_game_checkpoints') return [...rows.values()].map(view)
    if (name === 'claim_game_checkpoint') {
      let next = row
      if (!next) {
        next = {
          topic: args.p_topic,
          owner: identity,
          session: args.p_session,
          epoch: 1,
          revision: -1,
          state: null,
          leaseUntil: new Date(now + 20000).toISOString(),
          heartbeatAt: new Date(now).toISOString(),
          payload: { secrets: {}, authority: null },
        }
        rows.set(args.p_topic, next)
      }
      const previousHeartbeatAt = next.heartbeatAt
      if (
        next.session === args.p_session ||
        Date.parse(next.leaseUntil) <= now
      ) {
        if (next.session !== args.p_session) next.epoch++
        next.owner = identity
        next.session = args.p_session
        next.leaseUntil = new Date(now + 20000).toISOString()
        next.heartbeatAt = new Date(now).toISOString()
      }
      return { ...view(next), previousHeartbeatAt }
    }
    if (name === 'save_game_checkpoint') {
      if (failSave) throw Error('network')
      assert.equal(row.owner, identity)
      assert.equal(row.session, args.p_session)
      assert.equal(row.epoch, args.p_epoch)
      assert.ok(Date.parse(row.leaseUntil) > now)
      assert.ok(args.p_state.revision > row.revision)
      row.revision = args.p_state.revision
      row.state = clone(args.p_state)
      row.payload = clone(args.p_private)
      row.savedAt = new Date(now).toISOString()
      row.leaseUntil = new Date(now + 20000).toISOString()
      row.heartbeatAt = new Date(now).toISOString()
      events.push('saved')
      return { savedAt: row.savedAt, leaseUntil: row.leaseUntil }
    }
    if (name === 'renew_game_checkpoints')
      return [...rows.values()]
        .filter(
          (row) =>
            row.owner === identity &&
            row.session === args.p_session &&
            Date.parse(row.leaseUntil) > now &&
            args.p_topics.includes(row.topic),
        )
        .map((row) => {
          row.leaseUntil = new Date(now + 20000).toISOString()
          row.heartbeatAt = new Date(now).toISOString()
          return {
            topic: row.topic,
            leaseUntil: row.leaseUntil,
            serverNow: new Date(now).toISOString(),
          }
        })
    throw Error(name)
  }
  const client = (id, session = `${id}-device`, clockOffset = 0) => {
    const c = new GameRecoveryCoordinator(
      'QA-ROOM',
      id,
      rpc(id),
      () => connected,
      () => now + clockOffset,
      session,
    )
    let checkpoint = {
        state: {
          gameId: '',
          revision: 0,
          controllerIdentity: 'a',
          players: [],
        },
        secrets: {},
        authority: null,
      },
      ownPrivate
    c.bind(topic, {
      capture: () => checkpoint,
      restore(next, authoritative) {
        checkpoint = authoritative
          ? clone(next)
          : { ...checkpoint, state: clone(next.state) }
      },
      ownPrivate(value) {
        ownPrivate = value
      },
      committed() {
        events.push('published')
      },
      changed() {},
    })
    return {
      c,
      get checkpoint() {
        return checkpoint
      },
      get ownPrivate() {
        return ownPrivate
      },
      set(next) {
        checkpoint = clone(next)
      },
    }
  }
  const start = async (a) => {
    await a.c.refresh()
    await a.c.transact(topic, () => {
      a.set({
        state: {
          gameId: 'hand-1',
          revision: 1,
          controllerIdentity: 'a',
          players: [
            { identity: 'a', name: 'A' },
            { identity: 'b', name: 'B' },
          ],
          turnExpiresAt: now + 45000,
        },
        secrets: { a: ['AS', 'AH'], b: ['KS', 'KH'] },
        authority: { deck: ['2S', '2H'], chipTotal: 2000 },
      })
      return null
    })
  }
  return {
    client,
    start,
    events,
    rows,
    get now() {
      return now
    },
    advance(ms) {
      now += ms
    },
    peers(ids) {
      connected = ids
    },
    fail(value) {
      failSave = value
    },
  }
}
test('a move is durable before publication; peers can recover only their own hand', async () => {
  const h = fixture(),
    a = h.client('a'),
    b = h.client('b')
  await h.start(a)
  await b.c.refresh()
  assert.deepEqual(h.events, ['saved', 'published'])
  assert.deepEqual(b.ownPrivate, ['KS', 'KH'])
  assert.equal(b.c.records.get(topic).payload, null)
  assert.equal(b.checkpoint.state.gameId, 'hand-1')
  assert.equal(JSON.stringify(b.c.records.get(topic)).includes('AS'), false)
})
test('failed persistence rolls back the entire authority and never publishes an unconfirmed move', async () => {
  const h = fixture(),
    a = h.client('a')
  await h.start(a)
  const before = clone(a.checkpoint)
  h.fail(true)
  await assert.rejects(
    a.c.transact(topic, () => {
      a.set({
        ...a.checkpoint,
        state: { ...a.checkpoint.state, revision: 2 },
        authority: { deck: [], chipTotal: 0 },
      })
      return null
    }),
  )
  assert.deepEqual(a.checkpoint, before)
  assert.equal(h.events.length, 2)
})
test('controller failover preserves the deck, both hands, chip total and timers; old epochs are rejected', async () => {
  const h = fixture(),
    a = h.client('a'),
    b = h.client('b')
  await h.start(a)
  await b.c.refresh()
  h.peers(['b'])
  b.c.rosterChanged()
  h.advance(21000)
  await b.c.heartbeat()
  assert.equal(b.c.records.get(topic).owner, 'b')
  assert.equal(b.c.records.get(topic).epoch, 2)
  assert.deepEqual(b.checkpoint.secrets, a.checkpoint.secrets)
  assert.deepEqual(b.checkpoint.authority, a.checkpoint.authority)
  assert.equal(
    b.checkpoint.state.turnExpiresAt,
    a.checkpoint.state.turnExpiresAt + 21000,
  )
  assert.ok(b.c.paused(topic))
  assert.equal(b.c.accepts(topic, 'a', 1), false)
  h.peers(['a', 'b'])
  b.c.rosterChanged()
  await b.c.heartbeat()
  assert.equal(b.c.paused(topic), false)
  let executed = false
  await assert.rejects(
    a.c.transact(topic, () => {
      executed = true
      return null
    }),
  )
  assert.equal(executed, false)
  await a.c.refresh()
  assert.equal(a.c.records.get(topic).payload, null)
  assert.deepEqual(a.ownPrivate, ['AS', 'AH'])
})
test('refresh/reload of the same account on a new device cannot steal an active lease', async () => {
  const h = fixture(),
    a = h.client('a')
  await h.start(a)
  const replacement = h.client('a', 'new-tab')
  await replacement.c.refresh()
  assert.equal(replacement.c.records.get(topic).payload, null)
  await assert.rejects(replacement.c.transact(topic, () => null))
  h.advance(21000)
  await replacement.c.transact(topic, () => null)
  assert.deepEqual(replacement.checkpoint.authority, a.checkpoint.authority)
})
test('a failed takeover save does not reveal or publish an unconfirmed recovered authority', async () => {
  const h = fixture(),
    a = h.client('a'),
    b = h.client('b')
  await h.start(a)
  await b.c.refresh()
  const before = clone(b.checkpoint)
  h.peers(['b'])
  h.advance(21000)
  h.fail(true)
  await b.c.heartbeat()
  assert.deepEqual(b.checkpoint, before)
  assert.equal(h.events.filter((event) => event === 'published').length, 1)
  assert.ok(b.c.paused(topic))
  h.fail(false)
  await b.c.refresh()
  assert.deepEqual(b.checkpoint.authority, a.checkpoint.authority)
  assert.deepEqual(b.checkpoint.secrets, a.checkpoint.secrets)
})
test('temporary non-controller departure pauses for a bounded grace instead of folding immediately', async () => {
  const h = fixture(),
    a = h.client('a')
  await h.start(a)
  h.peers(['a'])
  a.c.rosterChanged()
  assert.ok(a.c.paused(topic))
  assert.ok(a.c.hasGrace('b'))
  const result = await a.c.transact(topic, () => {
    throw Error('must not run')
  })
  assert.match(result, /pausada/)
  h.advance(GAME_RECONNECT_GRACE_MS + 1)
  assert.equal(a.c.hasGrace('b'), false)
  assert.equal(a.c.paused(topic), false)
})
test('commands are serialized and duplicate/stale checkpoint revisions never replace a newer save', async () => {
  const h = fixture(),
    a = h.client('a')
  await h.start(a)
  await Promise.all(
    Array.from({ length: 20 }, () =>
      a.c.transact(topic, () => {
        a.set({
          ...a.checkpoint,
          state: {
            ...a.checkpoint.state,
            revision: a.checkpoint.state.revision + 1,
          },
        })
        return null
      }),
    ),
  )
  assert.equal(h.rows.get(topic).revision, 21)
})
test('timer shifting changes decision deadlines, not card values, timestamps or chip balances', () => {
  assert.deepEqual(
    shiftGameDeadlines(
      {
        expiresAt: 1200,
        nested: { resolvesAt: 0, transitionAt: 1800 },
        chips: 800,
        card: 42,
      },
      300,
    ),
    {
      expiresAt: 1500,
      nested: { resolvesAt: 0, transitionAt: 2100 },
      chips: 800,
      card: 42,
    },
  )
})
test('PC clocks hours apart do not steal a live lease or expire a recovered turn', async () => {
  const h = fixture(),
    a = h.client('a'),
    b = h.client('b', 'b-skewed', 3_600_000)
  await h.start(a)
  await b.c.refresh()
  assert.equal(b.c.accepts(topic, 'a', 1), true)
  assert.equal(b.checkpoint.state.turnExpiresAt - (h.now + 3_600_000), 45000)
  h.peers(['b'])
  h.advance(21000)
  await b.c.heartbeat()
  assert.equal(b.c.records.get(topic).owner, 'b')
  assert.equal(b.checkpoint.state.turnExpiresAt - (h.now + 3_600_000), 45000)
  assert.deepEqual(b.checkpoint.authority.deck, ['2S', '2H'])
})
