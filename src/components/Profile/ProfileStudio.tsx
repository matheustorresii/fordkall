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
  ProfileNameFont,
  ProfileTheme,
} from '../../types'
import { Icon } from '../ui/Icon'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { ProfileName } from './ProfileName'

const fontOptions: Array<{ id: ProfileNameFont; label: string }> = [
  { id: 'mono', label: 'Mono' },
  { id: 'condensed', label: 'Condensada' },
  { id: 'serif', label: 'Serifada' },
  { id: 'rounded', label: 'Arredondada' },
]

const frameOptions: Array<{ id: AvatarFrame; label: string }> = [
  { id: 'none', label: 'Sem aro' },
  { id: 'ring', label: 'Aro' },
  { id: 'double', label: 'Duplo' },
  { id: 'glow', label: 'Brilho' },
]

const colorOptions = ['#eef1ed', '#b9ef3a', '#57d6ff', '#a98bff', '#ff9857', '#ff6fae']

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
    <div
      className="profile-editor-v2"
      style={{ '--profile-accent': profileAccent(appearance) } as CSSProperties}
    >
      <section className="profile-editor-v2__identity">
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
        <button
          aria-label={value.avatarDataUrl ? 'Trocar foto do perfil' : 'Adicionar foto ao perfil'}
          className="profile-editor-v2__avatar"
          disabled={preparingAvatar}
          onClick={() => avatarInput.current?.click()}
          type="button"
        >
          <ProfileAvatar
            appearance={appearance}
            avatarDataUrl={value.avatarDataUrl}
            name={value.displayName || 'Você'}
          />
          <span><Icon name="image" /></span>
        </button>

        <div className="profile-editor-v2__summary">
          <small>PRÉVIA</small>
          <ProfileName appearance={appearance} name={value.displayName || 'Seu nome'} />
          <p>{value.bio || 'Uma descrição curta sobre você.'}</p>
          <div>
            <button disabled={preparingAvatar} onClick={() => avatarInput.current?.click()} type="button">
              {preparingAvatar ? 'Preparando imagem…' : value.avatarDataUrl ? 'Trocar foto' : 'Adicionar foto'}
            </button>
            {value.avatarDataUrl && (
              <button className="is-danger" onClick={() => onChange({ ...value, avatarDataUrl: undefined })} type="button">
                Remover
              </button>
            )}
          </div>
        </div>
      </section>

      {avatarError && <div className="inline-error"><Icon name="warning" />{avatarError}</div>}

      <section className="profile-editor-v2__section">
        <header><div><span>Identidade</span><small>O que as outras pessoas veem na call.</small></div></header>
        <div className="profile-editor-v2__fields">
          <label>
            <span>Nome exibido</span>
            <input
              maxLength={48}
              onChange={(event) => onChange({ ...value, displayName: event.target.value })}
              placeholder="Seu nome"
              value={value.displayName}
            />
          </label>
          <label>
            <span>Sobre você <small>{value.bio?.length || 0}/96</small></span>
            <input
              maxLength={96}
              onChange={(event) => onChange({ ...value, bio: event.target.value })}
              placeholder="Uma frase curta"
              value={value.bio || ''}
            />
          </label>
        </div>
      </section>

      <section className="profile-editor-v2__section">
        <header><div><span>Aparência</span><small>Personalização simples, sem afetar o layout da call.</small></div></header>
        <div className="profile-editor-v2__appearance">
          <div className="profile-editor-v2__control">
            <span>Tema</span>
            <div className="profile-theme-options">
              {(Object.keys(PROFILE_THEME_COLORS) as ProfileTheme[]).map((theme) => (
                <button
                  aria-label={`Tema ${theme}`}
                  className={appearance.theme === theme ? 'is-active' : ''}
                  key={theme}
                  onClick={() => updateAppearance({ theme })}
                  style={{ '--swatch': PROFILE_THEME_COLORS[theme] } as CSSProperties}
                  type="button"
                ><i /></button>
              ))}
            </div>
          </div>

          <div className="profile-editor-v2__control">
            <span>Cor do nome</span>
            <div className="profile-color-control">
              {colorOptions.map((color) => (
                <button
                  aria-label={`Cor ${color}`}
                  className={appearance.nameColor === color ? 'is-active' : ''}
                  key={color}
                  onClick={() => updateAppearance({ nameColor: color })}
                  style={{ '--swatch': color } as CSSProperties}
                  type="button"
                />
              ))}
              <label title="Escolher outra cor">
                <input aria-label="Cor personalizada do nome" onChange={(event) => updateAppearance({ nameColor: event.target.value })} type="color" value={appearance.nameColor} />
                <span>+</span>
              </label>
            </div>
          </div>
        </div>

        <div className="profile-editor-v2__control">
          <span>Fonte do nome</span>
          <div className="profile-segmented">
            {fontOptions.map((option) => (
              <button
                className={`${appearance.nameFont === option.id ? 'is-active' : ''} profile-name--${option.id}`}
                key={option.id}
                onClick={() => updateAppearance({ nameFont: option.id })}
                type="button"
              >{option.label}</button>
            ))}
          </div>
        </div>

        <div className="profile-editor-v2__control">
          <span>Moldura do avatar</span>
          <div className="profile-editor-v2__frames">
            {frameOptions.map((option) => (
              <button
                className={appearance.avatarFrame === option.id ? 'is-active' : ''}
                key={option.id}
                onClick={() => updateAppearance({ avatarFrame: option.id })}
                type="button"
              >{option.label}</button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
