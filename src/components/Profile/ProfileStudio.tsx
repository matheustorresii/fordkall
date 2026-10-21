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
import {
  CALL_BACKGROUNDS,
  PROFILE_DECORATIONS,
  cosmeticAsset,
} from '../../services/cosmetics'

const fontOptions: Array<{ id: ProfileNameFont; label: string }> = [
  { id: 'mono', label: 'Terminal' },
  { id: 'condensed', label: 'Racing' },
  { id: 'serif', label: 'Editorial' },
  { id: 'rounded', label: 'Arcade' },
]

const frameOptions: Array<{ id: AvatarFrame; label: string }> = [
  { id: 'none', label: 'Sem aro' },
  { id: 'ring', label: 'Aro' },
  { id: 'double', label: 'Duplo' },
  { id: 'glow', label: 'Brilho' },
]

const colorOptions = [
  '#eef1ed',
  '#b9ef3a',
  '#57d6ff',
  '#a98bff',
  '#ff9857',
  '#ff6fae',
]

export const ProfileStudio = ({
  value,
  onChange,
}: {
  value: LocalProfile
  onChange: (profile: LocalProfile) => void
}) => {
  const appearance = normalizeProfileAppearance(value.appearance)
  const presetThemeColors = Object.values(PROFILE_THEME_COLORS)
  const [avatarError, setAvatarError] = useState('')
  const [preparingAvatar, setPreparingAvatar] = useState(false)
  const [collection, setCollection] = useState('Todos')
  const [cosmeticTab, setCosmeticTab] = useState<'frames' | 'backgrounds'>(
    'frames',
  )
  const [studioTab, setStudioTab] = useState<
    'identity' | 'style' | 'collection'
  >('identity')
  const avatarInput = useRef<HTMLInputElement>(null)

  const updateAppearance = (
    patch: Partial<typeof DEFAULT_PROFILE_APPEARANCE>,
  ) => {
    onChange({ ...value, appearance: { ...appearance, ...patch } })
  }

  const selectAvatar = async (file: File) => {
    setPreparingAvatar(true)
    setAvatarError('')
    try {
      const avatarDataUrl = await prepareProfileAvatar(file)
      onChange({ ...value, avatarDataUrl })
    } catch (error) {
      setAvatarError(
        error instanceof Error
          ? error.message
          : 'Não foi possível usar essa imagem.',
      )
    } finally {
      setPreparingAvatar(false)
    }
  }

  return (
    <div
      className="profile-editor-v2"
      style={{ '--profile-accent': profileAccent(appearance) } as CSSProperties}
    >
      <section
        className="profile-editor-v2__identity"
        style={{
          backgroundImage: cosmeticAsset('background', appearance.backgroundId)
            ? `linear-gradient(#11192355,#111923aa),url("${cosmeticAsset('background', appearance.backgroundId)}")`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
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
          aria-label={
            value.avatarDataUrl
              ? 'Trocar foto do perfil'
              : 'Adicionar foto ao perfil'
          }
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
          <span>
            <Icon name="image" />
          </span>
        </button>

        <div className="profile-editor-v2__summary">
          <small>PRÉVIA</small>
          <ProfileName
            appearance={appearance}
            name={value.displayName || 'Seu nome'}
          />
          <p>{value.bio || 'Uma descrição curta sobre você.'}</p>
          <div>
            <button
              disabled={preparingAvatar}
              onClick={() => avatarInput.current?.click()}
              type="button"
            >
              {preparingAvatar
                ? 'Preparando imagem…'
                : value.avatarDataUrl
                  ? 'Trocar foto'
                  : 'Adicionar foto'}
            </button>
            {value.avatarDataUrl && (
              <button
                className="is-danger"
                onClick={() => onChange({ ...value, avatarDataUrl: undefined })}
                type="button"
              >
                Remover
              </button>
            )}
          </div>
        </div>
      </section>

      {avatarError && (
        <div className="inline-error">
          <Icon name="warning" />
          {avatarError}
        </div>
      )}
      <nav className="profile-studio-tabs" aria-label="Seções do perfil">
        {(
          [
            ['identity', 'Perfil'],
            ['style', 'Nome e cores'],
            ['collection', 'Molduras e fundos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={studioTab === id}
            onClick={() => setStudioTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section
        className="profile-editor-v2__section"
        hidden={studioTab !== 'identity'}
      >
        <header>
          <div>
            <span>Identidade</span>
            <small>O que as outras pessoas veem na call.</small>
          </div>
        </header>
        <div className="profile-editor-v2__fields">
          <label>
            <span>Nome exibido</span>
            <input
              maxLength={48}
              onChange={(event) =>
                onChange({ ...value, displayName: event.target.value })
              }
              placeholder="Seu nome"
              value={value.displayName}
            />
          </label>
          <label>
            <span>
              Sobre você <small>{value.bio?.length || 0}/96</small>
            </span>
            <input
              maxLength={96}
              onChange={(event) =>
                onChange({ ...value, bio: event.target.value })
              }
              placeholder="Uma frase curta"
              value={value.bio || ''}
            />
          </label>
        </div>
      </section>

      <section
        className="profile-editor-v2__section"
        hidden={studioTab !== 'style'}
      >
        <header>
          <div>
            <span>Aparência</span>
            <small>Personalização simples, sem afetar o layout da call.</small>
          </div>
        </header>
        <div className="profile-editor-v2__appearance">
          <div className="profile-editor-v2__control">
            <span>Tema</span>
            <div className="profile-theme-options">
              {(Object.keys(PROFILE_THEME_COLORS) as ProfileTheme[]).map(
                (theme) => (
                  <button
                    aria-label={`Tema ${theme}`}
                    className={
                      appearance.accentColor === PROFILE_THEME_COLORS[theme]
                        ? 'is-active'
                        : ''
                    }
                    key={theme}
                    onClick={() =>
                      updateAppearance({
                        theme,
                        accentColor: PROFILE_THEME_COLORS[theme],
                      })
                    }
                    style={
                      {
                        '--swatch': PROFILE_THEME_COLORS[theme],
                      } as CSSProperties
                    }
                    type="button"
                  >
                    <i />
                  </button>
                ),
              )}
              <label
                className={`profile-custom-color ${presetThemeColors.includes(appearance.accentColor) ? '' : 'is-active'}`.trim()}
                style={{ '--swatch': appearance.accentColor } as CSSProperties}
                title="Escolher qualquer cor para o tema"
              >
                <input
                  aria-label="Cor personalizada do tema"
                  onChange={(event) =>
                    updateAppearance({ accentColor: event.target.value })
                  }
                  type="color"
                  value={appearance.accentColor}
                />
                <i />
                <span>Personalizada</span>
              </label>
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
              <label
                className={`profile-custom-color ${colorOptions.includes(appearance.nameColor) ? '' : 'is-active'}`.trim()}
                style={{ '--swatch': appearance.nameColor } as CSSProperties}
                title="Escolher qualquer cor para o nome"
              >
                <input
                  aria-label="Cor personalizada do nome"
                  onChange={(event) =>
                    updateAppearance({ nameColor: event.target.value })
                  }
                  type="color"
                  value={appearance.nameColor}
                />
                <i />
                <span>Personalizada</span>
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
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-editor-v2__control">
          <span>Aro simples</span>
          <div className="profile-editor-v2__frames">
            {frameOptions.map((option) => (
              <button
                className={
                  appearance.avatarFrame === option.id ? 'is-active' : ''
                }
                key={option.id}
                onClick={() =>
                  updateAppearance({
                    avatarFrame: option.id,
                    decorationId: 'none',
                  })
                }
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section
        className="profile-editor-v2__section profile-cosmetics"
        hidden={studioTab !== 'collection'}
      >
        <header>
          <div>
            <span>Sua coleção</span>
            <small>Molduras e cenários selecionados para a call.</small>
          </div>
        </header>
        <div className="profile-segmented">
          <button
            type="button"
            className={cosmeticTab === 'frames' ? 'is-active' : ''}
            onClick={() => setCosmeticTab('frames')}
          >
            Molduras · 20
          </button>
          <button
            type="button"
            className={cosmeticTab === 'backgrounds' ? 'is-active' : ''}
            onClick={() => setCosmeticTab('backgrounds')}
          >
            Fundos · 20
          </button>
        </div>
        <div className="cosmetic-filters">
          {['Todos', 'Frangoelho', 'Avatar', 'Barbie', 'Coleção'].map((c) => (
            <button
              type="button"
              key={c}
              aria-pressed={collection === c}
              onClick={() => setCollection(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className={`cosmetic-grid cosmetic-grid--${cosmeticTab}`}>
          <button
            type="button"
            aria-pressed={
              (cosmeticTab === 'frames'
                ? appearance.decorationId
                : appearance.backgroundId) === 'none'
            }
            onClick={() =>
              updateAppearance(
                cosmeticTab === 'frames'
                  ? { decorationId: 'none' }
                  : { backgroundId: 'none' },
              )
            }
          >
            <span className="cosmetic-none">
              <Icon name="x" />
            </span>
            <strong>Nenhum</strong>
          </button>
          {(cosmeticTab === 'frames' ? PROFILE_DECORATIONS : CALL_BACKGROUNDS)
            .filter((x) => collection === 'Todos' || x[2] === collection)
            .map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-label={`Usar ${label}`}
                aria-pressed={
                  (cosmeticTab === 'frames'
                    ? appearance.decorationId
                    : appearance.backgroundId) === id
                }
                onClick={() =>
                  updateAppearance(
                    cosmeticTab === 'frames'
                      ? { decorationId: id, avatarFrame: 'none' }
                      : { backgroundId: id },
                  )
                }
              >
                {cosmeticTab === 'frames' ? (
                  <ProfileAvatar
                    appearance={{
                      ...appearance,
                      decorationId: id,
                      avatarFrame: 'none',
                    }}
                    avatarDataUrl={value.avatarDataUrl}
                    name={value.displayName || 'Você'}
                  />
                ) : (
                  <img
                    loading="lazy"
                    alt=""
                    src={cosmeticAsset('background', id)}
                  />
                )}
                <strong>{label}</strong>
              </button>
            ))}
        </div>
      </section>
    </div>
  )
}
