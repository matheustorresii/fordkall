import type { CSSProperties } from 'react'
import { normalizeProfileAppearance } from '../../services/profile'
import type { ProfileAppearance } from '../../types'

export const ProfileName = ({
  appearance,
  className = '',
  name,
  suffix,
}: {
  appearance?: Partial<ProfileAppearance>
  className?: string
  name: string
  suffix?: string
}) => {
  const normalized = normalizeProfileAppearance(appearance)
  const visibleName = String(name || '').trim() || 'Sem nome'
  return (
    <span className={`profile-name-wrap ${className}`.trim()} title={`${visibleName}${suffix || ''}`}>
      <strong
        className={`profile-name profile-name--${normalized.nameFont}`}
        style={{ color: normalized.nameColor } as CSSProperties}
      >
        {visibleName}{suffix}
      </strong>
    </span>
  )
}
