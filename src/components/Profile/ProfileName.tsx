import type { CSSProperties } from 'react'
import { normalizeProfileAppearance } from '../../services/profile'
import type { ProfileAppearance, ProfileBadge } from '../../types'

const badgeLabels: Record<Exclude<ProfileBadge, 'none'>, string> = {
  pilot: 'PILOTO',
  turbo: 'TURBO',
  night: 'NOTURNO',
  mechanic: 'MECÂNICO',
}

export const ProfileName = ({
  appearance,
  className = '',
  name,
  suffix,
  showBadge = true,
}: {
  appearance?: Partial<ProfileAppearance>
  className?: string
  name: string
  suffix?: string
  showBadge?: boolean
}) => {
  const normalized = normalizeProfileAppearance(appearance)
  return (
    <span className={`profile-name-wrap ${className}`.trim()}>
      <strong
        className={`profile-name profile-name--${normalized.nameFont}`}
        style={{ color: normalized.nameColor } as CSSProperties}
      >
        {name}{suffix}
      </strong>
      {showBadge && normalized.badge !== 'none' && (
        <i className={`profile-badge profile-badge--${normalized.theme}`}>
          {badgeLabels[normalized.badge]}
        </i>
      )}
    </span>
  )
}
