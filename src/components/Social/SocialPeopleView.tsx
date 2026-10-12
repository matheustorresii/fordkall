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
}

const PeopleCard = ({
  user,
  online,
  onMessage,
}: {
  user: SocialUser
  online: boolean
  onMessage: (user: SocialUser) => void
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
    <Button aria-label={`Enviar mensagem para ${user.displayName}`} leadingIcon={<Icon name="chat" />} onClick={() => onMessage(user)} size="small" variant="secondary" type="button">
      Mensagem
    </Button>
  </article>
)

export const SocialPeopleView = ({ currentUserId, onlineUsers, onMessage }: SocialPeopleViewProps) => {
  const [query, setQuery] = useState('')
  const [onlineCards, setOnlineCards] = useState<SocialUser[]>([])
  const [results, setResults] = useState<SocialUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const onlineKey = onlineUsers.map((user) => user.userId)
    .filter((id) => id !== currentUserId).slice(0, 30).sort().join(',')

  useEffect(() => {
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
  }, [onlineKey, currentUserId])

  useEffect(() => {
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
  }, [query, currentUserId])

  const onlineIds = new Set(onlineUsers.map((user) => user.userId))
  const onlineIdSet = new Set(onlineCards.map((user) => user.id))
  const visibleResults = results.filter((user) => !onlineIdSet.has(user.id))

  return (
    <section className="social-directory-view">
      <header className="social-page-heading">
        <div>
          <span className="social-eyebrow">COMUNIDADE</span>
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

      {onlineCards.length > 0 && (
        <section className="social-directory-section">
          <header className="social-section-title">
            <h2>Online agora</h2>
            <span>{onlineUsers.filter((user) => user.userId !== currentUserId).length}</span>
          </header>
          <div className="social-people-grid">
            {onlineCards.map((user) => (
              <PeopleCard key={user.id} onMessage={onMessage} online user={user} />
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
              <PeopleCard key={user.id} onMessage={onMessage} online={onlineIds.has(user.id)} user={user} />
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
