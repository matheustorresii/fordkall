import { useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_PROFILE_APPEARANCE,
  normalizeProfileAppearance,
  prepareProfileAvatar,
  profileAccent,
  PROFILE_THEME_COLORS,
} from '../../services/profile'
import type {
  AvatarFrame,
  LocalProfile,
  ProfileBadge,
  ProfileNameFont,
  ProfileTheme,
} from '../../types'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from './ProfileName'

const fontOptions: Array<{ id: ProfileNameFont; label: string }> = [
  { id: 'mono', label: 'Terminal' },
  { id: 'condensed', label: 'Pista' },
  { id: 'serif', label: 'Clássica' },
  { id: 'rounded', label: 'Suave' },
]

const frameOptions: Array<{ id: AvatarFrame; label: string }> = [
  { id: 'none', label: 'Limpa' },
  { id: 'ring', label: 'Aro' },
  { id: 'double', label: 'Duplo' },
  { id: 'glow', label: 'Neon' },
]

const badgeOptions: Array<{ id: ProfileBadge; label: string }> = [
  { id: 'none', label: 'Sem badge' },
  { id: 'pilot', label: 'Piloto' },
  { id: 'turbo', label: 'Turbo' },
  { id: 'night', label: 'Noturno' },
  { id: 'mechanic', label: 'Mecânico' },
]

export const ProfileStudio = ({
  value,
  onChange,
}: {
  value: LocalProfile
  onChange: (profile: LocalProfile) => void
}) => {
  const appearance = normalizeProfileAppearance(value.appearance)
  const [avatarError, setAvatarError] = useState('')
  const [preparingAvatar, setPreparingAvatar] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)

  const updateAppearance = (patch: Partial<typeof DEFAULT_PROFILE_APPEARANCE>) => {
    onChange({ ...value, appearance: { ...appearance, ...patch } })
  }

  const selectAvatar = async (file: File) => {
    setPreparingAvatar(true)
    setAvatarError('')
    try {
      const avatarDataUrl = await prepareProfileAvatar(file)
      onChange({ ...value, avatarDataUrl })
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Não foi possível usar essa imagem.')
    } finally {
      setPreparingAvatar(false)
    }
  }

  return (
    <div className="profile-studio">
      <section
        className={`profile-studio__preview profile-studio__preview--${appearance.theme}`}
        style={{ '--profile-accent': profileAccent(appearance) } as CSSProperties}
      >
        <span className="profile-studio__preview-label">PRÉVIA DO PERFIL</span>
        <div className="profile-studio__preview-card">
          <ProfileAvatar appearance={appearance} avatarDataUrl={value.avatarDataUrl} name={value.displayName || 'Novo piloto'} />
          <div>
            <ProfileName appearance={appearance} name={value.displayName || 'Novo piloto'} />
            <p>{value.bio || 'Sua frase aparece aqui quando alguém abre seu perfil.'}</p>
          </div>
        </div>
        <span className="profile-studio__preview-signal"><i /> ONLINE NA GARAGEM</span>
      </section>

      <section className="profile-studio__editor">
        <div className="profile-studio__identity">
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void selectAvatar(file)
              event.target.value = ''
            }}
            ref={avatarInput}
            type="file"
          />
          <button disabled={preparingAvatar} onClick={() => avatarInput.current?.click()} type="button">
            <ProfileAvatar appearance={appearance} avatarDataUrl={value.avatarDataUrl} name={value.displayName || 'Você'} />
            <span><Icon name="image" /></span>
          </button>
          <div>
            <strong>{preparingAvatar ? 'Preparando…' : value.avatarDataUrl ? 'Trocar avatar' : 'Adicionar avatar'}</strong>
            <small>PNG, JPG, WEBP ou GIF animado</small>
            {value.avatarDataUrl && <button onClick={() => onChange({ ...value, avatarDataUrl: undefined })} type="button">Remover</button>}
          </div>
        </div>
        {avatarError && <div className="inline-error"><Icon name="warning" />{avatarError}</div>}

        <div className="profile-studio__fields">
          <label><span>Nome exibido</span><input maxLength={48} onChange={(event) => onChange({ ...value, displayName: event.target.value })} placeholder="Como a galera te chama?" value={value.displayName} /></label>
          <label><span>Sobre você <small>{value.bio?.length || 0}/96</small></span><input maxLength={96} onChange={(event) => onChange({ ...value, bio: event.target.value })} placeholder="Uma frase, um aviso, uma loucura…" value={value.bio || ''} /></label>
        </div>

        <div className="profile-studio__section">
          <header><span>Tema do perfil</span><small>Muda a energia do card e da moldura.</small></header>
          <div className="profile-theme-options">
            {(Object.keys(PROFILE_THEME_COLORS) as ProfileTheme[]).map((theme) => (
              <button aria-label={`Tema ${theme}`} className={appearance.theme === theme ? 'is-active' : ''} key={theme} onClick={() => updateAppearance({ theme })} style={{ '--swatch': PROFILE_THEME_COLORS[theme] } as CSSProperties} type="button"><i /></button>
            ))}
          </div>
        </div>

        <div className="profile-studio__section">
          <header><span>Cor do nome</span><small>Vale dentro da call também.</small></header>
          <div className="profile-color-control">
            {['#eef1ed', '#b9ef3a', '#57d6ff', '#a98bff', '#ff9857', '#ff6fae'].map((color) => <button aria-label={`Cor ${color}`} className={appearance.nameColor === color ? 'is-active' : ''} key={color} onClick={() => updateAppearance({ nameColor: color })} style={{ '--swatch': color } as CSSProperties} type="button" />)}
            <label title="Escolher qualquer cor"><input aria-label="Cor personalizada do nome" onChange={(event) => updateAppearance({ nameColor: event.target.value })} type="color" value={appearance.nameColor} /><span>+</span></label>
          </div>
        </div>

        <div className="profile-studio__section">
          <header><span>Fonte do nome</span></header>
          <div className="profile-segmented">
            {fontOptions.map((option) => <button className={`${appearance.nameFont === option.id ? 'is-active' : ''} profile-name--${option.id}`} key={option.id} onClick={() => updateAppearance({ nameFont: option.id })} type="button">{option.label}</button>)}
          </div>
        </div>

        <div className="profile-studio__split">
          <div className="profile-studio__section">
            <header><span>Moldura</span></header>
            <select onChange={(event) => updateAppearance({ avatarFrame: event.target.value as AvatarFrame })} value={appearance.avatarFrame}>{frameOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          </div>
          <div className="profile-studio__section">
            <header><span>Badge cosmética</span></header>
            <select onChange={(event) => updateAppearance({ badge: event.target.value as ProfileBadge })} value={appearance.badge}>{badgeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
          </div>
        </div>
      </section>
    </div>
  )
}
