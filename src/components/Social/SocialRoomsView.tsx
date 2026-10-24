import { useEffect, useMemo, useState } from 'react'
import { getSocialProfileCards } from '../../services/social'
import type { CallDirectory } from '../../services/roomDirectoryPolicy'
import type { SocialPresenceEntry, SocialUser } from '../../types/social'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
interface Props extends CallDirectory {
  loading: boolean
  refreshing: boolean
  error: string
  refresh: () => Promise<void>
  activeRoomCode: string
  onlineUsers: SocialPresenceEntry[]
  previewUsers?: SocialUser[]
  connecting: boolean
  onCreateRoom: () => void
  onJoinByCode: () => void
  onJoinRoom: (code: string) => void
  favorites?: string[]
  onFavorite?: (code: string) => void
}
export const SocialRoomsView = (props: Props) => {
  const [tab, setTab] = useState<'public' | 'recent' | 'favorites'>('public')
  const [query, setQuery] = useState('')
  const [profiles, setProfiles] = useState<Map<string, SocialUser>>(new Map())
  const idsKey = [
    ...new Set(props.rooms.flatMap((room) => room.user_ids.slice(0, 6))),
  ]
    .sort()
    .slice(0, 100)
    .join(',')
  useEffect(() => {
    if (props.previewUsers) {
      setProfiles(new Map(props.previewUsers.map((user) => [user.id, user])))
      return
    }
    let cancelled = false
    const ids = idsKey ? idsKey.split(',') : []
    if (!ids.length) {
      setProfiles(new Map())
      return
    }
    void getSocialProfileCards(ids)
      .then((users) => {
        if (!cancelled) setProfiles(users)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [idsKey, props.previewUsers])
  const name = (id: string) =>
    profiles.get(id)?.displayName ||
    props.onlineUsers.find((user) => user.userId === id)?.displayName ||
    'Participante'
  const rows = useMemo(
    () =>
      tab === 'public'
        ? props.rooms.map((room) => ({
            ...room,
            is_private: false,
            last_joined_at: '',
          }))
        : (tab === 'favorites' ? [...props.recentRooms, ...props.rooms.filter(room => !props.recentRooms.some(recent => recent.code === room.code)).map(room => ({ code: room.code, is_private: false, last_joined_at: '' }))].filter(room => props.favorites?.includes(room.code)) : props.recentRooms).map((room) => ({
            ...room,
            user_ids:
              props.rooms.find((item) => item.code === room.code)?.user_ids ||
              [],
          })),
    [tab, props.rooms, props.recentRooms, props.favorites],
  )
  const search = query.trim().toLocaleLowerCase()
  const visible = rows.filter(
    (room) =>
      !search ||
      `${room.code} ${room.user_ids.map(name).join(' ')}`
        .toLocaleLowerCase()
        .includes(search),
  )
  return (
    <section className="home-rooms" aria-label="Salas">
      <header className="home-page-heading">
        <div>
          <h1>Salas</h1>
          <p>Encontre a galera. Ou comece sua própria call.</p>
        </div>
        <div className="home-heading-actions">
          <button
            className="home-button"
            type="button"
            onClick={props.onJoinByCode}
          >
            <Icon name="copy" />
            Entrar com código
          </button>
          <button
            className="home-button home-button--primary"
            type="button"
            onClick={props.onCreateRoom}
            disabled={props.connecting}
          >
            <Icon name="plus" />
            Criar sala
          </button>
        </div>
      </header>
      <div className="home-directory-toolbar">
        <div className="home-room-tabs" role="group" aria-label="Mostrar salas">
          <button
            type="button"
            aria-pressed={tab === 'public'}
            onClick={() => setTab('public')}
          >
            Públicas <span>{props.rooms.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === 'recent'}
            onClick={() => setTab('recent')}
          >
            Recentes
          </button>
          {props.onFavorite && <button type="button" aria-pressed={tab === 'favorites'} onClick={() => setTab('favorites')}>Favoritas</button>}
        </div>
        <button
          className="home-icon-button"
          title="Atualizar salas"
          aria-label="Atualizar salas"
          type="button"
          disabled={props.refreshing}
          onClick={() => void props.refresh()}
        >
          <Icon
            name="refresh"
            className={props.refreshing ? 'home-is-refreshing' : ''}
          />
        </button>
      </div>
      <div className="home-directory-intro">
        <p>
          {tab === 'public'
            ? 'Visíveis para todas as pessoas do Ford Kall.'
            : 'Salas que você já acessou. Só você vê esta lista.'}
        </p>
        <label className="home-search">
          <Icon name="search" />
          <input
            aria-label="Buscar salas"
            placeholder="Buscar sala ou pessoa"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {props.error ? (
        <p className="home-directory-notice" role="alert">
          <Icon name="warning" />
          {props.error}
          <button type="button" onClick={() => void props.refresh()}>
            Tentar novamente
          </button>
        </p>
      ) : (
        props.degraded && (
          <p className="home-directory-notice" role="status">
            <Icon name="info" />A lista pode estar atrasada. Você ainda pode
            entrar pelo código ou pelas salas recentes.
          </p>
        )
      )}
      <div className="home-room-list" aria-busy={props.loading}>
        {props.loading ? (
          <div className="home-room-empty">
            <span className="spinner" />
            <h2>Buscando salas…</h2>
          </div>
        ) : !visible.length ? (
          <div className="home-room-empty">
            <span className="home-empty-symbol">
              <Icon
                name={
                  search ? 'search' : tab === 'public' ? 'headphones' : 'home'
                }
              />
            </span>
            <h2>
              {search
                ? 'Nenhuma sala encontrada'
                : tab === 'public'
                  ? 'Nenhuma sala pública em call agora'
                  : 'Suas próximas salas ficam aqui'}
            </h2>
            <p>
              {search
                ? 'Tente outro código ou nome.'
                : tab === 'public'
                  ? 'Crie uma sala ou entre com um código. Se você saiu de uma call, procure em Recentes.'
                  : 'Depois de entrar em uma call, você poderá voltar por aqui — mesmo se ela for privada ou estiver vazia.'}
            </p>
            {!search && (
              <button
                className="home-button"
                type="button"
                onClick={
                  tab === 'public' ? props.onCreateRoom : props.onJoinByCode
                }
              >
                <Icon name="plus" />
                {tab === 'public' ? 'Criar sala' : 'Entrar com código'}
              </button>
            )}
          </div>
        ) : (
          visible.map((room) => {
            const live = room.user_ids.length > 0,
              current = props.activeRoomCode === room.code
            return (
              <article
                className={`home-room ${current ? 'home-room--current' : ''}`}
                key={room.code}
              >
                <div className="home-room__status">
                  {props.onFavorite && <button className="home-room__favorite" type="button" aria-label={`Favoritar sala ${room.code}`} aria-pressed={Boolean(props.favorites?.includes(room.code))} onClick={() => props.onFavorite?.(room.code)}><Icon name="star" /></button>}
                  <span
                    className={
                      room.is_private
                        ? 'home-private-label'
                        : 'home-public-label'
                    }
                  >
                    <Icon name={room.is_private ? 'lock' : 'users'} />
                    {room.is_private ? 'Privada' : 'Pública'}
                  </span>
                  {live && (
                    <span className="home-room__live">
                      <i />
                      {room.user_ids.length}{' '}
                      {room.user_ids.length === 1 ? 'pessoa' : 'pessoas'} em
                      call
                    </span>
                  )}
                </div>
                <h2>
                  {live && tab === 'public'
                    ? `Sala de ${name(room.user_ids[0]!)}`
                    : room.code}
                </h2>
                {tab === 'public' ? (
                  <p className="home-room__code">{room.code}</p>
                ) : (
                  <p className="home-room__recent">
                    {room.last_joined_at ? <>Último acesso{' '}
                    {new Date(room.last_joined_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                    })}</> : 'Salva nas suas favoritas'}
                  </p>
                )}
                <div className="home-room__people">
                  {room.user_ids.slice(0, 5).map((id) => (
                    <ProfileAvatar
                      key={id}
                      className="social-avatar"
                      name={name(id)}
                      title={name(id)}
                      appearance={profiles.get(id)?.appearance}
                      avatarDataUrl={profiles.get(id)?.avatarDataUrl}
                    />
                  ))}
                  {live ? (
                    <p>
                      {room.user_ids.slice(0, 2).map(name).join(', ')}
                      {room.user_ids.length > 2
                        ? ` e mais ${room.user_ids.length - 2}`
                        : ''}
                    </p>
                  ) : (
                    <p>
                      {room.is_private
                        ? 'Acesso pelo seu convite anterior.'
                        : 'Você pode entrar novamente com este código.'}
                    </p>
                  )}
                </div>
                <button
                  className="home-room__join"
                  type="button"
                  disabled={props.connecting}
                  onClick={() => props.onJoinRoom(room.code)}
                >
                  {current
                    ? 'Voltar à sua call'
                    : tab === 'recent'
                      ? 'Entrar novamente'
                      : 'Entrar na sala'}
                  <Icon name="chevron" />
                </button>
              </article>
            )
          })
        )}
      </div>
      <div className="home-private-help">
        <Icon name="lock" />
        <p>
          <strong>Procurando uma sala privada?</strong> Ela não aparece na lista
          pública. Use o código recebido ou encontre-a em Recentes, se já entrou
          antes.
        </p>
        <button type="button" onClick={props.onJoinByCode}>
          Entrar com código <Icon name="chevron" />
        </button>
      </div>
    </section>
  )
}
