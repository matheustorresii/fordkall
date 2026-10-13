import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  describeSocialError,
  getCommunityMessages,
  getDirectMessages,
  sendCommunityMessage,
  sendDirectMessage,
  subscribeToCommunityMessages,
  subscribeToDirectMessages,
} from '../../services/social'
import type { SocialMessage, SocialUser } from '../../types/social'
import { IconButton } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

type SocialMessageViewProps =
  | {
      mode: 'community'
      currentUser: SocialUser
      peer?: never
      onlineCount: number
      peerOnline?: never
    }
  | {
      mode: 'direct'
      currentUser: SocialUser
      peer: SocialUser
      onlineCount?: never
      peerOnline: boolean
    }

const timeLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value))

const mergeMessages = (current: SocialMessage[], incoming: SocialMessage) => {
  if (current.some((message) => message.id === incoming.id)) return current
  return [...current, incoming].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt),
  )
}

export const SocialMessageView = (props: SocialMessageViewProps) => {
  const [messages, setMessages] = useState<SocialMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isCommunity = props.mode === 'community'
  const peerId = props.mode === 'direct' ? props.peer.id : ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMessages([])
    setError('')

    const load = isCommunity
      ? getCommunityMessages()
      : getDirectMessages(props.currentUser.id, peerId)

    void load.then((nextMessages) => {
      if (!cancelled) {
        setMessages((current) => nextMessages.reduce(mergeMessages, current))
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(describeSocialError(cause, 'load'))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    const unsubscribe = isCommunity
      ? subscribeToCommunityMessages((message) => setMessages((current) => mergeMessages(current, message)))
      : subscribeToDirectMessages(props.currentUser.id, peerId, (message) =>
        setMessages((current) => mergeMessages(current, message)),
      )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [isCommunity, peerId, props.currentUser.id])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [messages.length, loading])

  const submit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const message = isCommunity
        ? await sendCommunityMessage(props.currentUser.id, body)
        : await sendDirectMessage(props.currentUser.id, peerId, body)
      setMessages((current) => mergeMessages(current, message))
      setDraft('')
    } catch (cause) {
      setError(describeSocialError(cause, 'send'))
    } finally {
      setSending(false)
    }
  }, [draft, isCommunity, peerId, props.currentUser.id, sending])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <section aria-label={isCommunity ? 'Chat geral' : `Conversa com ${props.mode === 'direct' ? props.peer.displayName : ''}`} className="social-message-view">
      <header className="social-message-header">
        {isCommunity ? (
          <span className="social-message-header__icon"><Icon name="hash" /></span>
        ) : props.mode === 'direct' ? (
          <ProfileAvatar
            appearance={props.peer.appearance}
            avatarDataUrl={props.peer.avatarDataUrl}
            className="social-avatar"
            name={props.peer.displayName}
          />
        ) : null}
        <div className="social-message-header__title">
          <h1>{isCommunity ? 'Geral' : props.mode === 'direct' ? props.peer.displayName : ''}</h1>
          <p>
            {isCommunity
              ? `${props.onlineCount} ${props.onlineCount === 1 ? 'pessoa online' : 'pessoas online'} · comunidade Ford Kall`
              : props.mode === 'direct' && props.peerOnline ? 'Online agora' : 'Mensagem direta'}
          </p>
        </div>
        {!isCommunity && props.mode === 'direct' && (
          <span className={`social-presence-pill ${props.peerOnline ? 'is-online' : ''}`}>
            <i />{props.peerOnline ? 'online' : 'offline'}
          </span>
        )}
      </header>

      <div aria-live="polite" className="social-message-list" ref={scrollRef}>
        {loading ? (
          <div className="social-message-state"><span className="spinner" />Carregando mensagens</div>
        ) : messages.length === 0 ? (
          <div className="social-message-empty">
            <span className="social-message-empty__icon"><Icon name={isCommunity ? 'hash' : 'chat'} /></span>
            <h2>{isCommunity ? 'Um lugar para começar' : `Converse com ${props.mode === 'direct' ? props.peer.displayName : ''}`}</h2>
            <p>{isCommunity ? 'Dê oi para a comunidade. Só contas ativas podem participar.' : 'Essa conversa é privada entre vocês dois.'}</p>
          </div>
        ) : (
          <div className="social-message-stack">
            {messages.map((message) => {
              const own = message.senderId === props.currentUser.id
              return (
                <article className={`social-message ${own ? 'is-own' : ''}`} key={message.id}>
                  <ProfileAvatar
                    appearance={message.sender.appearance}
                    avatarDataUrl={message.sender.avatarDataUrl}
                    className="social-avatar social-avatar--small"
                    name={message.sender.displayName}
                  />
                  <div className="social-message__body">
                    <div className="social-message__meta">
                      <ProfileName appearance={message.sender.appearance} name={own ? 'Você' : message.sender.displayName} />
                      <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                    </div>
                    <p>{message.body}</p>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {error && <div className="social-inline-error" role="alert">{error}</div>}
      <form className="social-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label={isCommunity ? 'Mensagem para o chat geral' : 'Mensagem direta'}
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isCommunity ? 'Escreva para a comunidade…' : `Mensagem para ${props.mode === 'direct' ? props.peer.displayName : ''}`}
          rows={1}
          value={draft}
        />
        <span className="social-composer__hint">Enter para enviar · Shift + Enter para pular linha</span>
        <IconButton aria-label="Enviar mensagem" disabled={!draft.trim() || sending} size="medium" type="submit" variant="secondary">
          {sending ? <span className="spinner" /> : <Icon name="send" />}
        </IconButton>
      </form>
    </section>
  )
}
