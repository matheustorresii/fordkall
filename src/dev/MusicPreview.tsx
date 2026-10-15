import { useEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent, type Room } from 'livekit-client'
import { MusicPanel } from '../components/Music/MusicPanel'
import { BrandMark } from '../components/ui/BrandMark'
import { Icon } from '../components/ui/Icon'
import { useRoomMusic } from '../hooks/useRoomMusic'
import { parseYouTubeSource } from '../music/model'
import type { PlayerDependencies } from '../music/YouTubeRoomPlayer'
import type { YouTubeApi, YouTubePlayer, YouTubePlayerOptions } from '../services/youtube'
import './MusicPreview.css'

type Receiver = (
  payload: Uint8Array,
  participant: { identity: string; name: string },
  kind: undefined,
  topic: string,
) => void
const createMesh = (count: number) => {
  const listeners = Array.from({ length: count }, () => new Map<string, Set<Receiver>>())
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        localParticipant: {
          identity: `p${index}`,
          name: index ? 'Gabriela' : 'Torres',
          publishData: async (payload: Uint8Array, options: { topic: string; destinationIdentities?: string[] }) => {
            for (let target = 0; target < count; target++)
              if (
                target !== index &&
                (!options.destinationIdentities || options.destinationIdentities.includes(`p${target}`))
              ) {
                const copy = new Uint8Array(payload)
                window.setTimeout(
                  () =>
                    listeners[target]!.get(RoomEvent.DataReceived)?.forEach((receive) =>
                      receive(
                        copy,
                        { identity: `p${index}`, name: index ? 'Gabriela' : 'Torres' },
                        undefined,
                        options.topic,
                      ),
                    ),
                  45,
                )
              }
          },
        },
        remoteParticipants: new Map(
          Array.from(
            { length: count },
            (_, i) => [`p${i}`, { identity: `p${i}`, name: i ? 'Gabriela' : 'Torres' }] as const,
          ).filter(([id]) => id !== `p${index}`),
        ),
        on(event: string, listener: Receiver) {
          if (!listeners[index]!.has(event)) listeners[index]!.set(event, new Set())
          listeners[index]!.get(event)!.add(listener)
          return this
        },
        off(event: string, listener: Receiver) {
          listeners[index]!.get(event)?.delete(listener)
          return this
        },
      }) as unknown as Room,
  )
}

const ids = ['M7lc1UVf-VE', 'jNQXAC9IVRw', 'dQw4w9WgXcQ']
const fakeApi = (): YouTubeApi => {
  class PreviewPlayer {
    private element: HTMLIFrameElement
    private events: YouTubePlayerOptions['events']
    private videoId = ids[0]!
    private position = 0
    private at = performance.now()
    private status = 5
    constructor(element: HTMLElement, options: YouTubePlayerOptions) {
      this.element = element as HTMLIFrameElement
      this.events = options.events
      queueMicrotask(() => this.events?.onReady?.({ target: this as unknown as YouTubePlayer, data: 5 }))
    }
    getIframe = () => this.element
    getVideoData = () => ({
      video_id: this.videoId,
      title:
        ['Late night drive — studio session', 'Another day · acoustic', 'Never gonna give you up'][
          ids.indexOf(this.videoId)
        ] || 'Música de teste',
    })
    getCurrentTime = () =>
      Math.min(180, this.position + (this.status === 1 ? (performance.now() - this.at) / 1_000 : 0))
    getDuration = () => 180
    getPlayerState = () => this.status
    getPlaylist = () => ids
    getPlaylistIndex = () => 0
    setVolume = () => {}
    change = (status: number) => {
      this.position = this.getCurrentTime()
      this.at = performance.now()
      this.status = status
      this.events?.onStateChange?.({ target: this as unknown as YouTubePlayer, data: status })
    }
    playVideo = () => this.change(1)
    pauseVideo = () => this.change(2)
    stopVideo = () => {
      this.status = 5
    }
    seekTo = (position: number) => {
      this.position = position
      this.at = performance.now()
    }
    cueVideoById = (options: { videoId: string; startSeconds?: number }) => {
      this.videoId = options.videoId
      this.position = options.startSeconds || 0
      this.at = performance.now()
      this.change(5)
    }
    loadVideoById = (options: { videoId: string; startSeconds?: number }) => {
      this.cueVideoById(options)
      this.playVideo()
    }
    cuePlaylist = () => this.change(5)
    destroy = () => this.element.remove()
  }
  return {
    Player: PreviewPlayer as unknown as YouTubeApi['Player'],
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  }
}
const fakeDependencies: PlayerDependencies = {
  api: () => Promise.resolve(fakeApi()),
  iframe: () => {
    const frame = document.createElement('iframe')
    frame.srcdoc =
      '<!doctype html><html><head><style>body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 80% 10%,#3a5168,transparent 70%),#19232f;color:#edf2f8;font:12px system-ui;overflow:hidden}.disc{width:116px;height:116px;display:grid;place-items:center;border:1px solid #7d9bb3;border-radius:50%;background:repeating-radial-gradient(circle,#27394b 0 3px,#1b2b3a 4px 6px);box-shadow:0 10px 40px #0003}.disc:after{content:"♪";display:grid;place-items:center;width:44px;height:44px;background:#b7ed39;border-radius:50%;color:#26380c;font-size:25px}small{position:absolute;bottom:12px;font-size:10px;color:#afbdcc;letter-spacing:.05em}</style></head><body><div class="disc"></div><small>SIMULAÇÃO · PLAYER DE TESTE</small></body></html>'
    return frame
  },
}

const Peer = ({ room, real, seed }: { room: Room; real: boolean; seed: boolean }) => {
  const music = useRoomMusic(room),
    [open, setOpen] = useState(true),
    seeded = useRef(false)
  useEffect(() => {
    if (!music.ready || !seed || seeded.current) return
    seeded.current = true
    if (!real) {
      music.addSource(parseYouTubeSource('https://music.youtube.com/playlist?list=PL12345678901234567890')!)
      music.addSource(parseYouTubeSource(ids[2]!)!)
    }
  }, [music.ready, seed, real, music.addSource])
  return (
    <section className="music-preview-peer">
      <header>
        <strong>{room.localParticipant.name}</strong>
        <span
          data-testid="music-debug"
          data-controller={music.state.controllerIdentity}
          data-playing={music.state.playing}
          data-playback={music.state.playbackId}
          data-track={music.state.playlistIndex}
        >
          {music.state.status} · faixa {music.state.playlistIndex + 1} · {music.state.listeners.length} ouvindo
        </span>
        <button onClick={() => setOpen(!open)} type="button">
          <Icon name="music" /> Player
        </button>
      </header>
      <div className="music-preview-person">
        <div>{room.localParticipant.name?.[0]}</div>
        <strong>{room.localParticipant.name}</strong>
        <span>Prévia local · sem entrar em uma call</span>
      </div>
      <MusicPanel
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        music={music}
        playerDependencies={real ? undefined : fakeDependencies}
      />
    </section>
  )
}
export const MusicPreview = () => {
  const real = new URLSearchParams(window.location.search).get('music-preview') === 'real'
  const rooms = useMemo(() => createMesh(real ? 1 : 2), [real])
  return (
    <main className={`music-preview ${real ? 'is-real' : ''}`}>
      <header>
        <div>
          <BrandMark />
          <strong>
            FORD KALL <span>Music / development</span>
          </strong>
        </div>
        <nav>
          <a href="/?music-preview=mock">Dois participantes simulados</a>
          <a href="/?music-preview=real">YouTube real</a>
        </nav>
      </header>
      <div className="music-preview-mesh">
        {rooms.map((room, index) => (
          <Peer key={index} room={room} real={real} seed={index === 0} />
        ))}
      </div>
    </main>
  )
}
