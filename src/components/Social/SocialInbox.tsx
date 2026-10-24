import { useState } from 'react'
import type { SocialConversation, SocialUser } from '../../types/social'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
interface Props {
  conversations: SocialConversation[]
  peer: SocialUser | null
  selected: boolean
  onlineIds: Set<string>
  error: string
  onSelect: (user: SocialUser | null) => void
  onNew: () => void
}
const time = (value: string) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString('pt-BR') ===
    new Date().toLocaleDateString('pt-BR')
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
export const SocialInbox = (props: Props) => {
  const [query, setQuery] = useState('')
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  return (
    <aside className="home-inbox" aria-label="Lista de conversas">
      <header>
        <h1>Conversas</h1>
        <button
          type="button"
          className="home-icon-button"
          aria-label="Nova conversa"
          title="Nova conversa"
          onClick={props.onNew}
        >
          <Icon name="plus" />
        </button>
      </header>
      <label className="home-search">
        <Icon name="search" />
        <input
          aria-label="Buscar conversa"
          placeholder="Buscar conversa"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="home-inbox-list">
        {matches('Conversa geral') && (
          <button
            type="button"
            aria-current={!props.peer && props.selected ? 'page' : undefined}
            className="home-inbox-item"
            onClick={() => props.onSelect(null)}
          >
            <span className="home-channel-avatar">
              <Icon name="hash" />
            </span>
            <span>
              <strong>Conversa geral</strong>
              <small>A comunidade toda aqui.</small>
            </span>
          </button>
        )}
        <p className="home-list-caption">Mensagens diretas</p>
        {props.conversations
          .filter((item) => matches(item.user.displayName))
          .map((item) => (
            <button
              type="button"
              key={item.user.id}
              className="home-inbox-item"
              aria-current={
                props.peer?.id === item.user.id && props.selected
                  ? 'page'
                  : undefined
              }
              onClick={() => props.onSelect(item.user)}
            >
              <span className="home-inbox-avatar">
                <ProfileAvatar
                  appearance={item.user.appearance}
                  avatarDataUrl={item.user.avatarDataUrl}
                  name={item.user.displayName}
                  className="social-avatar"
                />
                {props.onlineIds.has(item.user.id) && <i />}
              </span>
              <span>
                <strong>{item.user.displayName}</strong>
                <small>{item.lastMessage.body}</small>
              </span>
              <span className="home-inbox-item__meta">
                <time dateTime={item.lastMessage.createdAt}>
                  {time(item.lastMessage.createdAt)}
                </time>
                {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
              </span>
            </button>
          ))}
        {!props.conversations.length && (
          <p className="home-muted">
            Comece uma conversa pela aba Pessoas. Não precisa adicionar como
            amigo.
          </p>
        )}
        {props.conversations.length > 0 &&
          !props.conversations.some((item) =>
            matches(item.user.displayName),
          ) && <p className="home-muted">Nenhuma conversa com esse nome.</p>}
        {props.error && (
          <p className="home-form-error" role="alert">
            {props.error}
          </p>
        )}
      </div>
    </aside>
  )
}
