import test from 'node:test'
import assert from 'node:assert/strict'
import { YouTubeRoomPlayer } from '../src/music/YouTubeRoomPlayer.ts'
import { emptyMusicState, parseYouTubeSource, reduceMusicCommand } from '../src/music/model.ts'

const ids = ['M7lc1UVf-VE', 'dQw4w9WgXcQ', 'jNQXAC9IVRw']
const sender = { identity: 'p0', name: 'Pessoa' }
const start = (source = ids[0]) =>
  reduceMusicCommand(emptyMusicState(), { type: 'add', source: parseYouTubeSource(source) }, sender, 100_000)
const settled = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const setup = (t, { blocked = false, playlist = null, deferred = false } = {}) => {
  let now = 100_000,
    local,
    resolveApi
  const players = [],
    reports = [],
    resolutions = [],
    listeners = new Map()
  const original = { window: globalThis.window, document: globalThis.document }
  globalThis.window = {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event) => listeners.delete(event),
  }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event) => listeners.delete(event),
  }
  const host = {
    children: [],
    replaceChildren() {
      this.children.length = 0
    },
    append(iframe) {
      this.children.push(iframe)
    },
  }
  class FakePlayer {
    videoId = ids[0]
    position = 0
    duration = 180
    status = 5
    blocked = blocked
    destroyed = false
    seeks = []
    loads = []
    playAttempts = 0
    volume = 0
    constructor(iframe, options) {
      this.iframe = iframe
      this.events = options.events
      players.push(this)
      queueMicrotask(() => this.events.onReady({ target: this }))
    }
    getIframe = () => this.iframe
    getVideoData = () => ({ video_id: this.videoId, title: `Música ${this.videoId}` })
    getPlaylist = () => playlist
    getPlaylistIndex = () => 0
    cuePlaylist = () => {
      this.status = 5
    }
    getCurrentTime = () => this.position
    getDuration = () => this.duration
    getPlayerState = () => this.status
    setVolume = (value) => {
      this.volume = value
    }
    trigger = (value) => {
      this.status = value
      this.events.onStateChange({ target: this, data: value })
    }
    loadVideoById = (options) => {
      this.loads.push(options)
      this.videoId = options.videoId
      this.position = options.startSeconds
      this.playVideo()
    }
    cueVideoById = (options) => {
      this.loads.push(options)
      this.videoId = options.videoId
      this.position = options.startSeconds
      this.status = 5
    }
    seekTo = (position) => {
      this.seeks.push(position)
      this.position = position
    }
    playVideo = () => {
      this.playAttempts++
      if (this.blocked) {
        this.events.onAutoplayBlocked({ target: this })
        return
      }
      this.trigger(1)
    }
    pauseVideo = () => this.trigger(2)
    stopVideo = () => {
      this.status = 5
    }
    destroy = () => {
      this.destroyed = true
    }
  }
  const api = { Player: FakePlayer, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } }
  const adapter = new YouTubeRoomPlayer(
    host,
    {
      change: (state) => {
        local = state
      },
      report: (value) => reports.push(value),
      resolve: (...args) => resolutions.push(args),
    },
    {
      now: () => now,
      iframe: () => ({ src: 'about:blank' }),
      api: () =>
        deferred
          ? new Promise((resolve) => {
              resolveApi = resolve
            })
          : Promise.resolve(api),
    },
  )
  t.after(() => {
    adapter.dispose()
    globalThis.window = original.window
    globalThis.document = original.document
  })
  return {
    adapter,
    host,
    players,
    reports,
    resolutions,
    listeners,
    local: () => local,
    advance: (ms) => {
      now += ms
    },
    resolveApi: () => resolveApi(api),
  }
}

test('iframe inicia no ponto da sala; play/pause da sala não dependem de painel aberto', async (t) => {
  const f = setup(t),
    state = { ...start(), positionSeconds: 32 }
  f.adapter.update(state, true, 63)
  await settled()
  assert.equal(f.local().status, 'playing')
  assert.equal(f.players[0].position, 32)
  assert.equal(f.players[0].volume, 63)
  const paused = reduceMusicCommand(
    state,
    { type: 'set-playing', playbackId: state.playbackId, playing: false },
    sender,
    100_000,
  )
  f.adapter.update(paused, false, 63)
  assert.equal(f.players[0].status, 2)
  f.adapter.update({ ...paused, playing: true, status: 'loading' }, false, 63)
  assert.equal(f.players[0].status, 1)
})
test('autoplay bloqueado não fica repetindo play; clique libera e pausa local não é desfeita pelo heartbeat', async (t) => {
  const f = setup(t, { blocked: true }),
    state = start()
  f.adapter.update(state, false, 70)
  await settled()
  assert.equal(f.local().status, 'blocked')
  const attempts = f.players[0].playAttempts
  for (let i = 0; i < 6; i++) {
    f.advance(1_000)
    f.adapter.update({ ...state, syncSequence: i }, false, 70)
    f.adapter.sample()
  }
  assert.equal(f.players[0].playAttempts, attempts)
  f.players[0].blocked = false
  f.adapter.resume()
  assert.equal(f.local().status, 'playing')
  f.advance(1_000)
  f.players[0].pauseVideo()
  for (let i = 0; i < 3; i++) {
    f.advance(1_000)
    f.adapter.update(state, false, 70)
    f.adapter.sample()
  }
  assert.equal(f.players[0].status, 2)
  f.adapter.resume()
  assert.equal(f.players[0].status, 1)
})
test('desconectar destrói o iframe e uma API atrasada não o recria nem emite relatório', async (t) => {
  const f = setup(t, { deferred: true })
  f.adapter.update(start(), false, 70)
  f.adapter.dispose()
  f.resolveApi()
  await settled()
  assert.equal(f.host.children.length, 0)
  assert.equal(f.reports.length, 0)
  assert.equal(f.players.length, 0)
})
test('playlist é descoberta sem reprodução nativa; resolução preserva o mesmo iframe ativado', async (t) => {
  const f = setup(t, { playlist: ids }),
    state = start('https://music.youtube.com/playlist?list=PL12345678901234567890')
  f.adapter.update(state, false, 70)
  await settled()
  f.advance(1_100)
  f.adapter.sample()
  assert.equal(f.resolutions.length, 1)
  assert.deepEqual(f.resolutions[0].slice(2), [ids, 0, 3])
  assert.equal(f.players[0].playAttempts, 0)
  const resolved = reduceMusicCommand(
    state,
    { type: 'resolve', playbackId: state.playbackId, itemId: state.queue[0].id, videoIds: ids, offset: 0, total: 3 },
    sender,
    100_000,
  )
  f.adapter.update(resolved, false, 70)
  await settled()
  assert.equal(f.players[0].destroyed, false)
  assert.equal(f.players.length, 1)
  assert.equal(f.players[0].status, 1)
})
test('fim antigo e callbacks de iframe destruído são ignorados; fim válido só sai uma vez por reprodução', async (t) => {
  const f = setup(t),
    state = start()
  f.adapter.update(state, true, 70)
  await settled()
  const player = f.players[0]
  player.position = 180
  player.trigger(0)
  assert.equal(f.reports.filter((r) => r.status === 'ended').length, 0)
  f.advance(1_000)
  player.trigger(0)
  f.adapter.sample()
  assert.equal(f.reports.filter((r) => r.status === 'ended').length, 1)
  const seeking = reduceMusicCommand(
    state,
    { type: 'seek', playbackId: state.playbackId, position: 0 },
    sender,
    101_000,
  )
  f.adapter.update(seeking, true, 70)
  player.position = 180
  player.trigger(0)
  assert.equal(f.reports.filter((r) => r.status === 'ended').length, 1)
  const beforeDispose = f.local()
  f.adapter.dispose()
  player.events.onError({ target: player, data: 150 })
  assert.equal(f.local(), beforeDispose)
})
test('seguidor corrige desvio sem seek storm; o driver não disputa o próprio relógio', async (t) => {
  const f = setup(t),
    state = { ...start(), status: 'playing', driverIdentity: 'p1', positionSeconds: 25 }
  f.adapter.update(state, false, 70)
  await settled()
  const player = f.players[0],
    initial = player.seeks.length
  f.advance(4_000)
  player.position = 5
  f.adapter.sample()
  assert.equal(player.position, 29)
  assert.equal(player.seeks.length, initial + 1)
  player.position = 5
  f.adapter.sample()
  assert.equal(player.seeks.length, initial + 1)
  f.advance(4_000)
  f.adapter.update(state, true, 70)
  player.position = 5
  f.adapter.sample()
  assert.equal(player.position, 5)
})
test('criar playlist com erro e tentar novamente recria iframe e limpa o erro', async (t) => {
  const f = setup(t),
    state = start('https://youtube.com/playlist?list=PL12345678901234567890')
  f.adapter.update(state, false, 70)
  await settled()
  f.players[0].events.onError({ target: f.players[0], data: 100 })
  assert.equal(f.local().status, 'error')
  const retry = reduceMusicCommand(state, { type: 'retry', playbackId: state.playbackId }, sender, 100_000)
  f.adapter.update(retry, false, 70)
  await settled()
  assert.equal(f.players.length, 2)
  assert.notEqual(f.local().status, 'error')
})
test('uma faixa nova continua na aba oculta sem exigir reconectar ao voltar', async (t) => {
  const f = setup(t),
    state = start()
  document.visibilityState = 'hidden'
  f.adapter.update(state, false, 70)
  await settled()
  assert.ok(f.players[0].playAttempts > 0, 'escuta já habilitada não deve pausar a cada troca de música em background')
  document.visibilityState = 'visible'
  f.listeners.get('visibilitychange')()
  assert.equal(f.players[0].status, 1)
  assert.equal(f.players.length, 1)
})

test('sem evento de autoplay, um iframe parado oferece desbloqueio e não trava para sempre', async (t) => {
  const f = setup(t),
    state = start()
  f.adapter.update(state, false, 70)
  await settled()
  f.players[0].status = 5
  f.advance(5_000)
  f.adapter.sample()
  assert.equal(f.local().status, 'blocked')
  f.adapter.resume()
  assert.equal(f.players[0].status, 1)
})
test('a lista precisa estabilizar antes de resolver; uma prévia parcial não vira a fila definitiva', async (t) => {
  const f = setup(t, { playlist: [ids[0]] }),
    state = start('https://youtube.com/playlist?list=PL12345678901234567890')
  f.adapter.update(state, false, 70)
  await settled()
  assert.equal(f.resolutions.length, 0)
  f.advance(500)
  f.players[0].getPlaylist = () => ids
  f.adapter.sample()
  f.advance(500)
  f.adapter.sample()
  assert.equal(f.resolutions.length, 0)
  f.advance(500)
  f.adapter.sample()
  assert.deepEqual(f.resolutions[0][2], ids)
})

test('troca de coordenador realinha o mesmo vídeo antes de reportar um progresso offline', async (t) => {
  const f = setup(t),
    state = { ...start(), controllerIdentity: 'p0' }
  f.adapter.update(state, true, 70)
  await settled()
  f.advance(5_000)
  f.players[0].position = 100
  f.adapter.update({ ...state, controllerIdentity: '', status: 'waiting' }, false, 70)
  f.adapter.update(
    { ...state, controllerIdentity: 'p1', status: 'waiting', positionSeconds: 20, updatedAt: 105_000 },
    false,
    70,
  )
  assert.equal(f.players[0].position, 20)
  assert.equal(f.reports.at(-1).position, 20)
})
