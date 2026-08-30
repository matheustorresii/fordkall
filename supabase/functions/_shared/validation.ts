import { HttpError } from './http.ts'

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase()

export const normalizeInviteCode = (value: unknown) =>
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

export const normalizeRoomCode = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()

export const normalizeDisplayName = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, ' ').slice(0, 48)

export const normalizeProfileAppearance = (value: unknown) => {
  const appearance = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const color = String(appearance.nameColor || '').toLowerCase()
  const nameFont = String(appearance.nameFont || '')
  const theme = String(appearance.theme || '')
  const avatarFrame = String(appearance.avatarFrame || '')
  const badge = String(appearance.badge || '')
  return {
    nameColor: /^#[0-9a-f]{6}$/.test(color) ? color : '#eef1ed',
    nameFont: ['mono', 'condensed', 'serif', 'rounded'].includes(nameFont) ? nameFont : 'mono',
    theme: ['lime', 'ocean', 'violet', 'ember', 'rose'].includes(theme) ? theme : 'lime',
    avatarFrame: ['none', 'ring', 'double', 'glow'].includes(avatarFrame) ? avatarFrame : 'ring',
    badge: ['none', 'pilot', 'turbo', 'night', 'mechanic'].includes(badge) ? badge : 'none',
  }
}

export const assertEmail = (email: string) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'INVALID_EMAIL')
  }
}

export const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('')
}

export const createInviteCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const raw = [...bytes].map((value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]).join('')
  return `FK-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`
}
