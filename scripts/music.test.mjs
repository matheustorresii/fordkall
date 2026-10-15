import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomMusicSession } from '../src/music/RoomMusicSession.ts'
import {
  MAX_MUSIC_PACKET_BYTES,
  applyDriverReport,
  currentMusicVideo,
  emptyMusicState,
  parseYouTubeSource,
  readMusicCommand,
  readMusicReport,
  readMusicState,
  reduceMusicCommand,
  roomMusicPosition,
  serializedMusicState,
} from '../src/music/model.ts'
import { youtubeEmbedUrl } from '../src/services/youtube.ts'

const videos = ['M7lc1UVf-VE', 'dQw4w9WgXcQ', 'jNQXAC9IVRw']
const sender = { identity: 'a', name: 'Pessoa' }
const video = (index = 0) => parseYouTubeSource(videos[index])
const playlist = () => parseYouTubeSource('https://music.youtube.com/playlist?list=PL12345678901234567890')
const add = (state = emptyMusicState(), source = video()) =>
  reduceMusicCommand(state, { type: 'add', source }, sender, 1_000)
const report = (state, overrides = {}) => ({
  playbackId: state.playbackId,
  videoId: currentMusicVideo(state),
  status: 'playing',
  position: 10,
  duration: 180,
  title: 'Uma música',
  errorCode: 0,
  ...overrides,
})

const mesh = (count = 6, { delay = 25, skew = true, enabled = true } = {}) => {
  let time = 1_000_000
  const queue = [],
    nodes = new Map(),
    online = new Set(),
    packets = []
  const flush = () => {
    let safety = 0
    while (queue.some((packet) => packet.at <= time)) {
      assert.ok(safety++ < 20_000, 'não pode haver tempestade de mensagens')
      const index = queue.findIndex((packet) => packet.at <= time),
        packet = queue.splice(index, 1)[0]
      if (online.has(packet.to) && online.has(packet.from))
        nodes.get(packet.to).receive(packet.payload, packet.from, packet.from)
    }
  }
  const create = (id, listening = enabled) => {
    const offset = skew ? (Number(id.slice(1)) % 2 ? 37_000 : -24_000) : 0
    const session = new RoomMusicSession(
      {
        identity: id,
        name: id,
        send: async (payload, destination) => {
          for (const to of [...online].filter((peer) => peer !== id && (!destination || peer === destination))) {
            const packet = { from: id, to, payload: new Uint8Array(payload), at: time + delay }
            assert.ok(payload.byteLength <= MAX_MUSIC_PACKET_BYTES)
            packets.push(packet)
            queue.push(packet)
          }
        },
      },
      () => {},
      () => time + offset,
    )
    nodes.set(id, session)
    online.add(id)
    for (const [peer, node] of nodes) if (online.has(peer)) node.setPeers([...online].filter((p) => p !== peer))
    session.start(
      [...online].filter((p) => p !== id),
      listening,
    )
    return session
  }
  const advance = (ms) => {
    const end = time + ms
    while (time < end) {
      time = Math.min(end, time + 25)
      flush()
      for (const id of online) nodes.get(id).tick()
      flush()
    }
  }
  const leave = (id) => {
    online.delete(id)
    nodes.get(id).stop()
    for (const peer of online) nodes.get(peer).setPeers([...online].filter((p) => p !== peer))
    flush()
  }
  for (let i = 0; i < count; i++) create(`p${i}`)
  advance(1_000)
  const all = () => [...online].map((id) => nodes.get(id))
  const converge = () => {
    const states = all().map((node) => ({
      ...serializedMusicState(node.state),
      updatedAt: 0,
      positionSeconds:
        Math.round(
          roomMusicPosition(
            node.state,
            time + (skew ? (Number(node.transport.identity.slice(1)) % 2 ? 37_000 : -24_000) : 0),
          ) * 10,
        ) / 10,
    }))
    for (const state of states.slice(1)) assert.deepEqual(state, states[0])
  }
  return { nodes, all, advance, leave, create, packets, converge }
}

test('links de vídeos, timestamps, playlists e YouTube Music são normalizados sem perder o contexto', () => {
  for (const host of ['www.youtube.com', 'music.youtube.com', 'm.youtube.com']) {
    const parsed = parseYouTubeSource(
      `https://${host}/watch?v=${videos[0]}&list=PL12345678901234567890&index=4&t=1m25s`,
    )
    assert.equal(parsed.kind, 'playlist')
    assert.equal(parsed.startIndex, 3)
    assert.equal(parsed.startSeconds, 85)
    assert.equal(parsed.initialVideoId, videos[0])
  }
  assert.equal(
    parseYouTubeSource(`https://music.youtube.com/watch?v=${videos[0]}&list=RDAMVM${videos[0]}`).kind,
    'video',
  )
  assert.equal(
    parseYouTubeSource(`https://music.youtube.com/watch?v=${videos[0]}&list=RDAMVM${videos[0]}`, 'playlist').kind,
    'playlist',
  )
  assert.equal(parseYouTubeSource(`youtu.be/${videos[0]}?t=32`).startSeconds, 32)
  assert.equal(parseYouTubeSource(`https://youtube.com/shorts/${videos[0]}`).sourceId, videos[0])
  assert.equal(
    parseYouTubeSource(`https://www.youtube.com/watch?v=${videos[0]}&list=PL12345678901234567890`, 'video').kind,
    'video',
  )
  for (const input of [
    'javascript:alert(1)',
    'https://evil.test/watch?v=' + videos[0],
    'https://youtube.com.evil.test/watch?v=' + videos[0],
    'https://user:pass@youtube.com/watch?v=' + videos[0],
    'https://youtube.com:8080/watch?v=' + videos[0],
    'https://open.spotify.com/track/abc',
    '',
  ])
    assert.equal(parseYouTubeSource(input), null)
})
test('embed usa videoseries e a origem real; app de esquema próprio não inventa origem HTTP', () => {
  const web = new URL(
    youtubeEmbedUrl('', 'PL12345678901234567890', 3, { protocol: 'https:', origin: 'https://fordkall.11a3.dev' }),
  )
  assert.equal(web.pathname, '/embed/videoseries')
  assert.equal(web.searchParams.get('list'), 'PL12345678901234567890')
  assert.equal(web.searchParams.get('origin'), 'https://fordkall.11a3.dev')
  const app = new URL(youtubeEmbedUrl(videos[0], '', 0, { protocol: 'fordkall-app:', origin: 'fordkall-app://app' }))
  assert.equal(app.searchParams.has('origin'), false)
  assert.equal(app.searchParams.get('autoplay'), '0')
})
test('comandos antigos, mensagens inválidas e estados incoerentes são rejeitados', () => {
  const state = add()
  assert.equal(readMusicCommand({ type: 'advance-playlist', nextPlaylistIndex: 2 }), null)
  assert.equal(readMusicCommand({ type: 'seek', playbackId: state.playbackId, position: NaN }), null)
  assert.equal(readMusicReport({ ...report(state), duration: Infinity }), null)
  assert.equal(readMusicState({ ...emptyMusicState(), playing: true }), null)
  assert.equal(readMusicState({ ...state, status: 'playing', driverIdentity: '' }), null)
  assert.equal(readMusicState({ ...state, metadata: { ...state.metadata, videoId: videos[2] } }), null)
  assert.ok(readMusicState(serializedMusicState(state)))
  assert.equal(reduceMusicCommand(state, { type: 'next', playbackId: 'old' }, sender), state)
})
test('só o relógio de uma reprodução de verdade avança o progresso; pausa, seek e fim preservam posição', () => {
  let state = add()
  assert.equal(roomMusicPosition(state, 60_000), 0)
  state = applyDriverReport(state, report(state), 'p1', 2_000)
  assert.equal(roomMusicPosition(state, 4_000), 12)
  const paused = reduceMusicCommand(
    state,
    { type: 'set-playing', playbackId: state.playbackId, playing: false },
    sender,
    4_000,
  )
  assert.equal(roomMusicPosition(paused, 100_000), 12)
  const seeking = reduceMusicCommand(
    paused,
    { type: 'seek', playbackId: paused.playbackId, position: 50 },
    sender,
    5_000,
  )
  assert.notEqual(seeking.playbackId, paused.playbackId)
  assert.equal(seeking.metadata.duration, 180)
  assert.equal(seeking.positionSeconds, 50)
  const ended = applyDriverReport(state, report(state, { status: 'ended', position: 180 }), 'p1', 10_000)
  assert.equal(ended.status, 'ended')
  assert.equal(ended.positionSeconds, 180)
})
test('playlist é uma lista canônica única; repetição e início específico não dependem do autoplay do YouTube', () => {
  let state = add(
    emptyMusicState(),
    parseYouTubeSource(`https://youtube.com/watch?v=${videos[1]}&list=PL12345678901234567890&index=2&t=12`),
  )
  const initial = state.playbackId
  state = reduceMusicCommand(
    state,
    { type: 'resolve', playbackId: initial, itemId: state.queue[0].id, videoIds: videos, offset: 0, total: 3 },
    sender,
  )
  assert.equal(currentMusicVideo(state), videos[1])
  assert.equal(state.playlistIndex, 1)
  assert.equal(state.positionSeconds, 12)
  assert.equal(
    reduceMusicCommand(
      state,
      {
        type: 'resolve',
        playbackId: initial,
        itemId: state.queue[0].id,
        videoIds: [...videos].reverse(),
        offset: 0,
        total: 3,
      },
      sender,
    ),
    state,
  )
  state = reduceMusicCommand(state, { type: 'repeat', repeat: 'one' }, sender)
  state = applyDriverReport(state, report(state), 'p1')
  const repeated = applyDriverReport(state, report(state, { status: 'ended', position: 180 }), 'p1')
  assert.equal(repeated.playlistIndex, 1)
  assert.notEqual(repeated.playbackId, state.playbackId)
  state = reduceMusicCommand(state, { type: 'next', playbackId: state.playbackId }, sender)
  assert.equal(state.playlistIndex, 2)
})
test('seis participantes elegem um só coordenador e controlam a fila sem ter um iframe pronto', () => {
  const network = mesh(),
    p4 = network.nodes.get('p4')
  assert.ok(network.all().every((p) => p.ready && p.state.controllerIdentity === 'p0'))
  assert.equal(p4.command({ type: 'add', source: video() }), true)
  network.advance(100)
  network.converge()
  const token = p4.state.playbackId
  p4.command({ type: 'set-playing', playbackId: token, playing: false })
  network.advance(100)
  network.converge()
  assert.ok(network.all().every((p) => !p.state.playing))
  p4.command({ type: 'set-playing', playbackId: token, playing: true })
  network.advance(100)
  network.advance(20_000)
  network.converge()
  assert.equal(roomMusicPosition(p4.state), 0)
})
test('todos recebem a mesma playlist; só o driver pode avançar e um END atrasado não pula faixas', () => {
  const n = mesh(),
    p0 = n.nodes.get('p0'),
    p1 = n.nodes.get('p1'),
    p4 = n.nodes.get('p4')
  p0.command({ type: 'add', source: playlist() })
  n.advance(100)
  const token = p0.state.playbackId,
    itemId = p0.state.queue[0].id
  p4.command({ type: 'resolve', playbackId: token, itemId, videoIds: videos, offset: 0, total: 3 })
  n.advance(100)
  p1.command({ type: 'resolve', playbackId: token, itemId, videoIds: [...videos].reverse(), offset: 0, total: 3 })
  n.advance(100)
  p4.report(report(p4.state))
  n.advance(100)
  assert.equal(p0.state.driverIdentity, 'p4')
  p1.report(report(p1.state, { status: 'ended', position: 180 }))
  n.advance(100)
  assert.equal(p0.state.playlistIndex, 0)
  const ended = report(p4.state, { status: 'ended', position: 180 })
  p4.report(ended)
  n.advance(100)
  n.converge()
  assert.equal(p0.state.playlistIndex, 1)
  p4.report(ended)
  n.advance(100)
  assert.equal(p0.state.playlistIndex, 1)
  assert.deepEqual(p0.state.queue[0].videoIds, videos)
})
test('desconectar a escuta troca o driver, não pausa ninguém e não reconecta na próxima faixa', () => {
  const n = mesh(),
    p0 = n.nodes.get('p0'),
    p1 = n.nodes.get('p1'),
    p2 = n.nodes.get('p2')
  p0.command({ type: 'add', source: video() })
  n.advance(100)
  p1.report(report(p1.state))
  n.advance(100)
  p2.report(report(p2.state))
  n.advance(100)
  assert.equal(p0.state.driverIdentity, 'p1')
  p1.setListening(false)
  n.advance(100)
  assert.equal(p0.state.driverIdentity, 'p2')
  assert.equal(p0.state.playing, true)
  p0.command({ type: 'add', source: video(1) })
  p0.command({ type: 'next', playbackId: p0.state.playbackId })
  n.advance(100)
  assert.equal(p1.enabled, false)
  assert.equal(currentMusicVideo(p2.state), videos[1])
})
test('coordenador sem escuta funciona; nenhum ouvinte não gera progresso fictício', () => {
  const n = mesh(3, { enabled: false }),
    p0 = n.nodes.get('p0'),
    p2 = n.nodes.get('p2')
  p0.command({ type: 'add', source: video() })
  n.advance(100)
  p2.setListening(true)
  n.advance(100)
  p2.report(report(p2.state, { position: 0 }))
  n.advance(100)
  assert.equal(p0.state.driverIdentity, 'p2')
  p2.setListening(false)
  n.advance(100)
  const position = roomMusicPosition(p0.state)
  n.advance(20_000)
  assert.equal(roomMusicPosition(p0.state), position)
})
test('atraso de rede e relógios diferentes não causam deriva cumulativa; entrada tardia recebe o ponto atual', () => {
  const n = mesh(3, { delay: 125 }),
    p0 = n.nodes.get('p0'),
    p2 = n.nodes.get('p2')
  p0.command({ type: 'add', source: video() })
  n.advance(300)
  for (let i = 0; i < 20; i++) {
    p2.report(report(p2.state, { position: 10 + i }))
    n.advance(1_000)
  }
  n.converge()
  const late = n.create('p7')
  n.advance(1_000)
  assert.equal(currentMusicVideo(late.state), videos[0])
  assert.ok(
    Math.abs(
      roomMusicPosition(late.state, 1_000_000 + 37_000 + 22_300) -
        roomMusicPosition(p0.state, 1_000_000 - 24_000 + 22_300),
    ) < 0.3,
  )
})
test('saída do coordenador e reconexão preservam fila, faixa, posição e permitem novos comandos', () => {
  const n = mesh(),
    p0 = n.nodes.get('p0'),
    p3 = n.nodes.get('p3')
  p0.command({ type: 'add', source: video() })
  p0.command({ type: 'add', source: video(1) })
  n.advance(100)
  p3.report(report(p3.state, { position: 42 }))
  n.advance(100)
  const token = p0.state.playbackId
  n.leave('p0')
  n.advance(1_000)
  assert.ok(
    n
      .all()
      .every(
        (node) =>
          node.ready &&
          node.state.controllerIdentity === 'p1' &&
          node.state.queue.length === 2 &&
          node.state.playbackId === token,
      ),
  )
  p3.report(report(p3.state, { position: 43 }))
  n.advance(100)
  p3.reconnect(
    n
      .all()
      .map((p) => p.transport.identity)
      .filter((id) => id !== 'p3'),
  )
  n.advance(200)
  assert.equal(p3.ready, true)
  assert.equal(p3.state.queue.length, 2)
  p3.command({ type: 'next', playbackId: p3.state.playbackId })
  n.advance(100)
  n.converge()
  assert.equal(currentMusicVideo(p3.state), videos[1])
})
test('erro em um dispositivo não pula a faixa de todos; erro geral fica recuperável e não prende controles', () => {
  const n = mesh(2),
    p0 = n.nodes.get('p0'),
    p1 = n.nodes.get('p1')
  p0.command({ type: 'add', source: video() })
  n.advance(100)
  p0.report(report(p0.state, { status: 'error', errorCode: 150 }))
  n.advance(100)
  assert.equal(p0.state.playing, true)
  p1.report(report(p1.state))
  n.advance(100)
  assert.equal(p0.state.status, 'playing')
  p1.report(report(p1.state, { status: 'error', errorCode: 150 }))
  n.advance(100)
  assert.equal(p0.state.status, 'unavailable')
  assert.equal(p0.state.playing, false)
  const token = p0.state.playbackId
  p1.command({ type: 'retry', playbackId: token })
  n.advance(100)
  assert.notEqual(p0.state.playbackId, token)
  assert.equal(p0.state.playing, true)
  p1.command({ type: 'clear' })
  n.advance(100)
  assert.equal(p0.state.queue.length, 0)
})
test('comandos duplicados não adicionam duas vezes e um peer não pode usurpar a autoridade', () => {
  const n = mesh(2),
    p0 = n.nodes.get('p0'),
    p1 = n.nodes.get('p1')
  p1.command({ type: 'add', source: video() })
  n.advance(100)
  const packet = n.packets.find(
    (p) => p.from === 'p1' && JSON.parse(new TextDecoder().decode(p.payload)).type === 'command',
  )
  p0.receive(packet.payload, 'p1')
  n.advance(100)
  assert.equal(p0.state.queue.length, 1)
  n.advance(3_000)
  p0.receive(
    new TextEncoder().encode(
      JSON.stringify({
        type: 'state',
        state: { ...serializedMusicState(p0.state), controllerIdentity: 'p1', revision: 9999 },
      }),
    ),
    'p1',
  )
  assert.equal(p0.state.controllerIdentity, 'p0')
})

test('remover, limpar, voltar e repetir a fila mantêm índices e epochs coerentes', () => {
  let state = add()
  state = reduceMusicCommand(state, { type: 'add', source: video(1) }, sender, 1_000)
  state = reduceMusicCommand(state, { type: 'previous', playbackId: state.playbackId }, sender, 1_000)
  assert.equal(state.currentIndex, 0)
  assert.equal(state.playlistIndex, 0)
  state = reduceMusicCommand(state, { type: 'next', playbackId: state.playbackId }, sender, 1_000)
  const token = state.playbackId
  state = reduceMusicCommand(state, { type: 'remove', itemId: state.queue[0].id }, sender, 1_000)
  assert.equal(state.currentIndex, 0)
  assert.equal(state.playbackId, token)
  assert.equal(currentMusicVideo(state), videos[1])
  state = reduceMusicCommand(state, { type: 'repeat', repeat: 'all' }, sender, 1_000)
  state = reduceMusicCommand(state, { type: 'next', playbackId: state.playbackId }, sender, 1_000)
  assert.equal(currentMusicVideo(state), videos[1])
  assert.notEqual(state.playbackId, token)
  state = reduceMusicCommand(state, { type: 'remove', itemId: state.queue[0].id }, sender, 1_000)
  assert.equal(state.status, 'idle')
  assert.equal(state.currentIndex, -1)
  assert.equal(state.playing, false)
  assert.ok(readMusicState(serializedMusicState(state)))
})
test('índice explícito distingue músicas repetidas na mesma playlist', () => {
  let state = add(
    emptyMusicState(),
    parseYouTubeSource(`https://youtube.com/watch?v=${videos[0]}&list=PL12345678901234567890&index=3`),
  )
  state = reduceMusicCommand(
    state,
    {
      type: 'resolve',
      playbackId: state.playbackId,
      itemId: state.queue[0].id,
      videoIds: [videos[0], videos[1], videos[0]],
      offset: 0,
      total: 3,
    },
    sender,
  )
  assert.equal(state.playlistIndex, 2)
})
test('relatório local também é validado; título longo não cria um estado diferente dos remotos', () => {
  const n = mesh(2),
    p0 = n.nodes.get('p0')
  p0.command({ type: 'add', source: video() })
  n.advance(100)
  p0.report(report(p0.state, { title: '🎵'.repeat(200) }))
  n.advance(100)
  n.converge()
  assert.equal(p0.state.metadata.title.length, 160)
  p0.report(report(p0.state, { position: Infinity }))
  assert.ok(Number.isFinite(p0.state.positionSeconds))
})
test('reconectar a escuta não reutiliza um relatório antigo como se já estivesse tocando', () => {
  const n = mesh(2),
    p0 = n.nodes.get('p0'),
    p1 = n.nodes.get('p1')
  p0.command({ type: 'add', source: video() })
  n.advance(100)
  p1.report(report(p1.state))
  n.advance(100)
  p1.setListening(false)
  n.advance(100)
  p1.setListening(true)
  n.advance(100)
  assert.equal(p0.state.driverIdentity, '')
  assert.equal(p0.state.status, 'waiting')
  p1.report(report(p1.state))
  n.advance(100)
  assert.equal(p0.state.driverIdentity, 'p1')
})
