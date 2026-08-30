import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatMessage } from '../../types'
import { MAX_CHAT_IMAGE_SIZE } from '../../hooks/useRoomChat'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from '../Profile/ProfileName'

interface ChatPanelProps {
  open: boolean
  messages: ChatMessage[]
  error: string
  onClose: () => void
  onErrorClose: () => void
  onSendText: (text: string) => Promise<boolean>
  onSendImage: (file: File) => Promise<boolean>
}

const messageTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const ChatPanel = ({
  open,
  messages,
  error,
  onClose,
  onErrorClose,
  onSendText,
  onSendImage,
}: ChatPanelProps) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [messages, open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    const sent = await onSendText(text)
    if (sent) setText('')
    setSending(false)
  }

  return (
    <aside aria-hidden={!open} aria-label="Chat da call" className={`chat-panel ${open ? 'is-open' : ''}`}>
      <header>
        <div><Icon name="chat" /><span><strong>Chat da call</strong><small>Só quem está online recebe</small></span></div>
        <button aria-label="Fechar chat" className="icon-button" onClick={onClose} type="button"><Icon name="x" /></button>
      </header>

      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="chat-empty"><Icon name="chat" /><strong>A frequência está quieta.</strong><span>Mande a primeira mensagem.</span></div>
        )}
        {messages.map((message) => (
          <article className={`chat-message ${message.isLocal ? 'chat-message--local' : ''}`} key={message.id}>
            <header>
              <ProfileAvatar
                appearance={message.senderAppearance}
                avatarDataUrl={message.senderAvatarUrl}
                className="chat-message__avatar"
                name={message.senderName}
              />
              <span><ProfileName appearance={message.senderAppearance} name={message.senderName} /><time>{messageTime(message.sentAt)}</time></span>
            </header>
            {message.kind === 'text' ? (
              <p>{message.text}</p>
            ) : (
              <a href={message.imageUrl} rel="noreferrer" target="_blank">
                <img alt={message.imageName || `Imagem enviada por ${message.senderName}`} src={message.imageUrl} />
              </a>
            )}
            {message.status === 'sending' && <small>Enviando…</small>}
            {message.status === 'error' && <small className="is-error">Falha no envio</small>}
          </article>
        ))}
      </div>

      {error && <div className="chat-error"><span>{error}</span><button aria-label="Fechar erro do chat" onClick={onErrorClose} type="button"><Icon name="x" /></button></div>}

      <form onSubmit={submit}>
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          aria-label={`Enviar imagem de até ${MAX_CHAT_IMAGE_SIZE / 1024 / 1024} MB`}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onSendImage(file)
            event.target.value = ''
          }}
          ref={fileRef}
          type="file"
        />
        <button aria-label="Enviar imagem" className="chat-attach" onClick={() => fileRef.current?.click()} type="button"><Icon name="image" /></button>
        <textarea
          aria-label="Mensagem"
          maxLength={2000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Mensagem para a sala"
          rows={1}
          value={text}
        />
        <button aria-label="Enviar mensagem" className="chat-send" disabled={!text.trim() || sending} type="submit"><Icon name="send" /></button>
      </form>
    </aside>
  )
}
