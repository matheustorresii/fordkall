import type { SocialConversation, SocialPresenceEntry, SocialUser } from '../../types/social'
import { BrandMark } from '../ui/BrandMark'
import { Button, IconButton } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'

export type SocialSection = 'general' | 'people' | 'rooms'

interface SocialSidebarProps {
  section: SocialSection
  selectedConversationId: string
  conversations: SocialConversation[]
  onlineUsers: SocialPresenceEntry[]
  onlineCards: SocialUser[]
  mobileOpen: boolean
  onCloseMobile: () => void
  onSelectSection: (section: SocialSection) => void
  onSelectConversation: (user: SocialUser) => void
  onNewMessage: () => void
  onCreateRoom: () => void
}

const navItems: { section: SocialSection; icon: 'hash' | 'users' | 'mic'; label: string }[] = [
  { section: 'rooms', icon: 'mic', label: 'Início' },
  { section: 'general', icon: 'hash', label: 'Conversa geral' },
  { section: 'people', icon: 'users', label: 'Pessoas' },
]

export const SocialSidebar = ({
  section,
  selectedConversationId,
  conversations,
  onlineUsers,
  onlineCards,
  mobileOpen,
  onCloseMobile,
  onSelectSection,
  onSelectConversation,
  onNewMessage,
  onCreateRoom,
}: SocialSidebarProps) => (
  <>
    {mobileOpen && (
      <button
        aria-label="Fechar menu"
        className="social-sidebar-backdrop"
        onClick={onCloseMobile}
        type="button"
      />
    )}
    <aside className={`social-sidebar ${mobileOpen ? 'social-sidebar--open' : ''}`}>
      <a className="social-brand" href="#home" onClick={(event) => event.preventDefault()}>
        <BrandMark />
        <span>FORD KALL</span>
      </a>

      <div className="social-sidebar__community-label">SEU ESPAÇO</div>
      <nav aria-label="Navegação social" className="social-nav">
        {navItems.map((item) => (
          <button
            aria-current={section === item.section ? 'page' : undefined}
            className={`social-nav__item ${section === item.section ? 'is-active' : ''}`}
            key={item.section}
            onClick={() => onSelectSection(item.section)}
            type="button"
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.section === 'people' && onlineUsers.length > 0 && (
              <small>{onlineUsers.length}</small>
            )}
            {item.section === 'rooms' && onlineUsers.some((user) => user.activeRoom) && (
              <i className="social-nav__live-dot" />
            )}
          </button>
        ))}
      </nav>

      <div className="social-sidebar__section-heading">
        <span>CONVERSAS</span>
        <IconButton aria-label="Nova conversa" onClick={onNewMessage} size="small" title="Nova conversa" type="button">
          <Icon name="plus" />
        </IconButton>
      </div>
      <div className="social-conversation-list">
        {conversations.length === 0 ? (
          <p className="social-sidebar__empty">Suas mensagens diretas aparecem aqui.</p>
        ) : conversations.map((conversation) => (
          <button
            aria-current={selectedConversationId === conversation.user.id ? 'page' : undefined}
            className={`social-conversation ${selectedConversationId === conversation.user.id ? 'is-active' : ''}`}
            key={conversation.user.id}
            onClick={() => onSelectConversation(conversation.user)}
            type="button"
          >
            <ProfileAvatar
              appearance={conversation.user.appearance}
              avatarDataUrl={conversation.user.avatarDataUrl}
              className="social-avatar social-avatar--small"
              name={conversation.user.displayName}
            />
            <span className="social-conversation__copy">
              <strong>{conversation.user.displayName}</strong>
              <small>{conversation.lastMessage.body}</small>
            </span>
            {conversation.unreadCount > 0 && <i className="social-unread" />}
          </button>
        ))}
      </div>

      <div className="social-sidebar__section-heading social-sidebar__section-heading--online">
        <span>ONLINE AGORA</span>
        <span className="social-sidebar__count">{onlineUsers.length}</span>
      </div>
      <div className="social-online-list">
        {onlineCards.slice(0, 6).map((user) => (
          <div className="social-online-user" key={user.id} title={user.displayName}>
            <span className="social-online-user__avatar-wrap">
              <ProfileAvatar
                appearance={user.appearance}
                avatarDataUrl={user.avatarDataUrl}
                className="social-avatar social-avatar--tiny"
                name={user.displayName}
              />
              <i />
            </span>
            <span>{user.displayName}</span>
          </div>
        ))}
        {onlineUsers.length > 6 && (
          <Button className="social-online-more" onClick={() => onSelectSection('people')} size="small" variant="quiet" type="button">
            Ver mais {onlineUsers.length - 6}
          </Button>
        )}
      </div>

      <Button className="social-sidebar__create-room" leadingIcon={<Icon name="plus" />} onClick={onCreateRoom} variant="primary" type="button">
        Criar sala
      </Button>
    </aside>
  </>
)
