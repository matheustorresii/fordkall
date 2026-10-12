import type { ProfileAppearance } from './index'

export interface SocialUser {
  id: string
  displayName: string
  avatarDataUrl?: string
  bio?: string
  appearance: ProfileAppearance
}

export interface SocialMessage {
  id: string
  senderId: string
  sender: SocialUser
  body: string
  createdAt: string
  readAt?: string
}

export interface SocialConversation {
  user: SocialUser
  lastMessage: {
    senderId: string
    body: string
    createdAt: string
  }
  unreadCount: number
}

export interface SocialPresenceEntry {
  userId: string
  displayName: string
  activeRoom?: string
}
