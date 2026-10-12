import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { roomCodeFromInput } from '../../services/livekit'
import { getSocialProfileCards } from '../../services/social'
import type { SocialPresenceEntry, SocialUser } from '../../types/social'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'

interface SocialRoom {
  code: string
  people: SocialPresenceEntry[]
}

interface SocialRoomsViewProps {
  initialRoomCode: string
  onlineUsers: SocialPresenceEntry[]
  connectionError: string
  connecting: boolean
  onCreateRoom: () => void
  onJoinRoom: (code: string) => void
}

export const SocialRoomsView = ({
  initialRoomCode,
  onlineUsers,
  connectionError,
  connecting,
  onCreateRoom,
  onJoinRoom,
}: SocialRoomsViewProps) => {
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [profiles, setProfiles] = useState<Map<string, SocialUser>>(new Map())
  const [validationError, setValidationError] = useState('')
  const rooms = useMemo(() => {
    const byCode = new Map<string, Map<string, SocialPresenceEntry>>()
    onlineUsers.forEach((user) => {
      if (!user.activeRoom) return
      const code = roomCodeFromInput(user.activeRoom)
      if (!code) return
      const people = byCode.get(code) || new Map<string, SocialPresenceEntry>()
      people.set(user.userId, user)
      byCode.set(code, people)
    })
    return [...byCode.entries()]
      .map(([code, people]) => ({ code, people: [...people.values()] }))
      .sort((first, second) => second.people.length - first.people.length)
  }, [onlineUsers])
  const activeIds = [...new Set(rooms.flatMap((room) => room.people.slice(0, 5).map((person) => person.userId)))]
    .sort()
    .slice(0, 60)
  const activeIdsKey = activeIds.join(',')

  useEffect(() => {
    if (initialRoomCode) setRoomCode(initialRoomCode)
  }, [initialRoomCode])

  useEffect(() => {
    let cancelled = false
    if (!activeIds.length) {
      setProfiles(new Map())
      return
    }
    void getSocialProfileCards(activeIds).then((nextProfiles) => {
      if (!cancelled) setProfiles(nextProfiles)
    }).catch(() => {
      if (!cancelled) setProfiles(new Map())
    })
    return () => { cancelled = true }
  }, [activeIdsKey])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = roomCodeFromInput(roomCode)
    if (!normalized) {
      setValidationError('Digite um código de sala ou cole o link do convite.')
      return
    }
    setValidationError('')
    onJoinRoom(normalized)
  }

  return (
    <section className="social-rooms-view">
      <header className="social-page-heading social-page-heading--rooms">
        <div>
          <span className="social-eyebrow">AO VIVO</span>
          <h1>Salas</h1>
          <p>Calls abertas agora para a comunidade.</p>
        </div>
        <Button className="social-primary-button" disabled={connecting} leadingIcon={connecting ? <span className="spinner" /> : <Icon name="plus" />} onClick={onCreateRoom} variant="primary" type="button">
          Criar sala
        </Button>
      </header>

      <form className="social-room-join" onSubmit={submit}>
        <span className="social-room-join__icon"><Icon name="copy" /></span>
        <div>
          <strong>Entrar por convite</strong>
          <small>Cole um código ou link privado de sala.</small>
        </div>
        <input
          aria-label="Código ou link da sala"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={240}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="KIW-7294-ABC"
          spellCheck={false}
          value={roomCode}
        />
        <Button disabled={connecting} size="small" type="submit" variant="secondary">Entrar</Button>
      </form>
      {(validationError || connectionError) && (
        <p className="social-inline-error" role="alert">{validationError || connectionError}</p>
      )}

      <div className="social-rooms-divider">
        <span>Salas ativas</span>
        <small>{rooms.length}</small>
      </div>

      {rooms.length === 0 ? (
        <div className="social-rooms-empty">
          <span><Icon name="mic" /></span>
          <h2>Ninguém em call por enquanto</h2>
          <p>Crie uma sala e ela aparece aqui enquanto você estiver conectado.</p>
          <Button className="social-secondary-button" disabled={connecting} leadingIcon={<Icon name="plus" />} onClick={onCreateRoom} variant="secondary" type="button">
            Criar sala
          </Button>
        </div>
      ) : (
        <div className="social-room-grid">
          {rooms.map((room: SocialRoom) => (
            <article className="social-room-card" key={room.code}>
              <div className="social-room-card__top">
                <span className="social-room-card__live"><i /> AO VIVO</span>
                <span className="social-room-card__count"><Icon name="users" /> {room.people.length}</span>
              </div>
              <h2>{room.people[0]?.displayName || 'Sala da comunidade'}</h2>
              <p className="social-room-card__code">{room.code}</p>
              <div className="social-room-card__people">
                {room.people.slice(0, 5).map((person) => {
                  const user = profiles.get(person.userId)
                  return (
                    <ProfileAvatar
                      appearance={user?.appearance}
                      avatarDataUrl={user?.avatarDataUrl}
                      className="social-avatar social-avatar--small"
                      key={person.userId}
                      name={user?.displayName || person.displayName}
                      title={user?.displayName || person.displayName}
                    />
                  )
                })}
                {room.people.length > 5 && <span className="social-room-card__more">+{room.people.length - 5}</span>}
              </div>
              <Button className="social-room-card__join" disabled={connecting} onClick={() => onJoinRoom(room.code)} trailingIcon={<Icon name="chevron" />} variant="secondary" type="button">
                Entrar na sala
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
