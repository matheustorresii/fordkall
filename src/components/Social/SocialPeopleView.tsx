import { useEffect, useState } from 'react'
import { getSocialProfileCards, searchSocialUsers } from '../../services/social'
import type { SocialPresenceEntry, SocialUser } from '../../types/social'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

interface SocialPeopleViewProps {
  currentUserId: string
  onlineUsers: SocialPresenceEntry[]
  onMessage: (user: SocialUser) => void
  previewUsers?: SocialUser[]
  onCall?: (user: SocialUser) => void
  favorites?: string[]
  onFavorite?: (user: SocialUser) => void
}

const PeopleCard = ({
  user,
  online,
  onMessage,
  onCall, favorite, onFavorite,
}: {
  user: SocialUser
  online: boolean
  onMessage: (user: SocialUser) => void
  onCall?: (user: SocialUser) => void
  favorite?: boolean
  onFavorite?: (user: SocialUser) => void
}) => (
  <article className="social-person-card">
    <ProfileAvatar
      appearance={user.appearance}
      avatarDataUrl={user.avatarDataUrl}
      className="social-avatar social-avatar--large"
      name={user.displayName}
    />
    <div className="social-person-card__copy">
      <ProfileName appearance={user.appearance} name={user.displayName} />
      <span className={`social-person-card__status ${online ? 'is-online' : ''}`}>
        <i />{online ? 'Online agora' : 'Membro da comunidade'}
      </span>
      {user.bio && <p>{user.bio}</p>}
    </div>
    <div className="social-person-actions">
    {onFavorite && <button className="social-action-icon" type="button" aria-pressed={Boolean(favorite)} aria-label={`Favoritar ${user.displayName}`} onClick={() => onFavorite(user)}><Icon name="star" /></button>}
    {onCall && <button className="social-action-icon" type="button" aria-label={`Ligar para ${user.displayName}`} title="Ligar por voz" onClick={() => onCall(user)}><Icon name="phone" /></button>}
    <Button aria-label={`Enviar mensagem para ${user.displayName}`} leadingIcon={<Icon name="chat" />} onClick={() => onMessage(user)} size="small" variant="secondary" type="button">
      Mensagem
    </Button>
    </div>
  </article>
)

export const SocialPeopleView = ({ currentUserId, onlineUsers, onMessage, previewUsers, onCall, favorites = [], onFavorite }: SocialPeopleViewProps) => {
  const [query, setQuery] = useState('')
  const [onlineCards, setOnlineCards] = useState<SocialUser[]>([])
  const [results, setResults] = useState<SocialUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const onlineKey = onlineUsers.map((user) => user.userId)
    .filter((id) => id !== currentUserId).slice(0, 30).sort().join(',')

  useEffect(() => {
    if (previewUsers) { setOnlineCards(previewUsers.filter(user => user.id !== currentUserId)); return }
    let cancelled = false
    const ids = onlineKey ? onlineKey.split(',') : []
    if (ids.length === 0) {
      setOnlineCards([])
      return
    }
    void getSocialProfileCards(ids).then((users) => {
      if (!cancelled) setOnlineCards(ids.flatMap((id) => users.get(id) || []))
    }).catch(() => {
      if (!cancelled) setOnlineCards([])
    })
    return () => { cancelled = true }
  }, [onlineKey, currentUserId, previewUsers])

  useEffect(() => {
    if (previewUsers) { setResults(previewUsers.filter(user => user.id !== currentUserId && user.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))); setLoading(false); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void searchSocialUsers(query).then((users) => {
        if (!cancelled) setResults(users.filter((user) => user.id !== currentUserId))
      }).catch(() => {
        if (!cancelled) setError('Não foi possível buscar pessoas agora.')
      }).finally(() => {
        if (!cancelled) setLoading(false)
      })
    }, query ? 220 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, currentUserId, previewUsers])

  const onlineIds = new Set(onlineUsers.map((user) => user.userId))
  const matchingOnline = onlineCards.filter((user) => user.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const onlineIdSet = new Set(matchingOnline.map((user) => user.id))
  const visibleResults = results.filter((user) => !onlineIdSet.has(user.id)).sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)))

  return (
    <section className="social-directory-view">
      <header className="social-page-heading">
        <div>
          <h1>Pessoas</h1>
          <p>Encontre alguém e comece uma conversa direta.</p>
        </div>
        <label className="social-search-field">
          <Icon name="search" />
          <input
            aria-label="Buscar pessoas"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome"
            value={query}
          />
        </label>
      </header>

      {matchingOnline.length > 0 && (
        <section className="social-directory-section">
          <header className="social-section-title">
            <h2>Online agora</h2>
            <span>{onlineUsers.filter((user) => user.userId !== currentUserId).length}</span>
          </header>
          <div className="social-people-grid">
            {matchingOnline.map((user) => (
              <PeopleCard key={user.id} onMessage={onMessage} onCall={onCall} onFavorite={onFavorite} favorite={favorites.includes(user.id)} online user={user} />
            ))}
          </div>
          {onlineCards.length > 0 && onlineUsers.filter((user) => user.userId !== currentUserId).length > onlineCards.length && (
            <p className="social-empty-note">Mostrando os primeiros {onlineCards.length} perfis online. Use a busca para encontrar alguém específico.</p>
          )}
        </section>
      )}

      <section className="social-directory-section">
        <header className="social-section-title">
          <h2>{query.trim() ? 'Resultados' : 'Membros'}</h2>
          <span>{loading ? '…' : results.length}</span>
        </header>
        {error ? (
          <p className="social-empty-note" role="alert">{error}</p>
        ) : loading ? (
          <p className="social-empty-note"><span className="spinner" /> Buscando pessoas…</p>
        ) : visibleResults.length === 0 ? (
          <p className="social-empty-note">
            {query.trim() ? 'Nenhum perfil encontrado com esse nome.' : 'Ainda não há outras contas para mostrar.'}
          </p>
        ) : (
          <div className="social-people-grid">
            {visibleResults.map((user) => (
              <PeopleCard key={user.id} onMessage={onMessage} onCall={onCall} onFavorite={onFavorite} favorite={favorites.includes(user.id)} online={onlineIds.has(user.id)} user={user} />
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
