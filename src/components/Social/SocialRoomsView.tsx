import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../services/supabase'
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
  previewRooms?:{code:string;user_ids:string[]}[]
}

export const SocialRoomsView = ({
  initialRoomCode,
  onlineUsers,
  connectionError,
  connecting,
  onCreateRoom,
  onJoinRoom,
  previewRooms,
}: SocialRoomsViewProps) => {
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [profiles, setProfiles] = useState<Map<string, SocialUser>>(new Map())
  const [validationError, setValidationError] = useState('')
  const [rooms,setRooms]=useState<SocialRoom[]>([]),[roomsError,setRoomsError]=useState(''),[loading,setLoading]=useState(true)
  useEffect(()=>{
    if(previewRooms){setLoading(false);setRooms(previewRooms.map(r=>({code:r.code,people:r.user_ids.map(id=>onlineUsers.find(u=>u.userId===id)||{userId:id,displayName:'Pessoa'})})));return}
    let stopped=false
    const load=async()=>{const {data,error}=await supabase.rpc('list_public_call_rooms');if(stopped)return;setLoading(false);if(error){setRoomsError('Não foi possível buscar as salas. Tentaremos novamente.');return}setRoomsError('');setRooms(((data||[]) as {code:string;user_ids:string[]}[]).map(r=>({code:r.code,people:r.user_ids.map(id=>({userId:id,displayName:onlineUsers.find(u=>u.userId===id)?.displayName||'Pessoa'}))})).sort((a,b)=>b.people.length-a.people.length))}
    void load();const timer=window.setInterval(()=>void load(),15_000)
    return ()=>{stopped=true;window.clearInterval(timer)}
  },[onlineUsers])
  const activeIds = [...new Set(rooms.flatMap((room) => room.people.slice(0, 5).map((person) => person.userId)))]
    .sort()
    .slice(0, 60)
  const activeIdsKey = activeIds.join(',')

  useEffect(() => {
    if (initialRoomCode) setRoomCode(initialRoomCode)
  }, [initialRoomCode])

  useEffect(() => {
    let cancelled = false
    if(previewRooms)return
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
          <span className="social-eyebrow">FORD KALL</span>
          <h1>Chega mais.</h1>
          <p>Entre em uma call, mande uma mensagem ou reúna a galera.</p>
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
      {roomsError&&<p className="social-inline-error" role="alert">{roomsError}</p>}

      {rooms.length === 0 ? (
        <div className="social-rooms-empty">
          <span><Icon name="mic" /></span>
          <h2>{loading?'Buscando salas…':'Sua próxima call começa aqui'}</h2>
          <p>{loading?'':'Crie uma sala pública ou convide só quem você quiser para uma privada.'}</p>
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
