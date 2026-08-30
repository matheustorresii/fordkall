import type { CSSProperties } from 'react'
import { normalizeProfileAppearance, profileAccent } from '../../services/profile'
import type { ProfileAppearance } from '../../types'

const initialsFor = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'

export const ProfileAvatar = ({
  avatarDataUrl,
  className = '',
  name,
  appearance,
}: {
  avatarDataUrl?: string
  className?: string
  name: string
  appearance?: Partial<ProfileAppearance>
}) => (
  <span
    className={`profile-avatar profile-avatar--frame-${normalizeProfileAppearance(appearance).avatarFrame} ${className}`.trim()}
    style={{ '--profile-accent': profileAccent(appearance) } as CSSProperties}
  >
    {avatarDataUrl ? (
      <img alt={`Avatar de ${name}`} draggable={false} src={avatarDataUrl} />
    ) : (
      <span aria-hidden="true">{initialsFor(name)}</span>
    )}
  </span>
)
