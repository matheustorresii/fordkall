import type {
  AvatarFrame,
  LocalProfile,
  ParticipantProfile,
  ProfileAppearance,
  ProfileNameFont,
  ProfileTheme,
} from '../types'

export const PROFILE_METADATA_VERSION = 2
export const MAX_PROFILE_GIF_BYTES = 300 * 1024
export const MAX_PROFILE_SOURCE_BYTES = 8 * 1024 * 1024
export const MAX_PROFILE_AVATAR_DATA_URL_LENGTH = 430_000

const supportedAvatarTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export const PROFILE_THEME_COLORS: Record<ProfileTheme, string> = {
  lime: '#b9ef3a',
  ocean: '#57d6ff',
  violet: '#a98bff',
  ember: '#ff9857',
  rose: '#ff6fae',
}

export const DEFAULT_PROFILE_APPEARANCE: ProfileAppearance = {
  nameColor: '#eef1ed',
  nameFont: 'mono',
  theme: 'lime',
  avatarFrame: 'ring',
}

const nameFonts = new Set<ProfileNameFont>(['mono', 'condensed', 'serif', 'rounded'])
const themes = new Set<ProfileTheme>(['lime', 'ocean', 'violet', 'ember', 'rose'])
const avatarFrames = new Set<AvatarFrame>(['none', 'ring', 'double', 'glow'])

export const normalizeProfileAppearance = (value?: Partial<ProfileAppearance> | null): ProfileAppearance => ({
  nameColor: typeof value?.nameColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.nameColor)
    ? value.nameColor.toLowerCase()
    : DEFAULT_PROFILE_APPEARANCE.nameColor,
  nameFont: nameFonts.has(value?.nameFont as ProfileNameFont)
    ? value?.nameFont as ProfileNameFont
    : DEFAULT_PROFILE_APPEARANCE.nameFont,
  theme: themes.has(value?.theme as ProfileTheme)
    ? value?.theme as ProfileTheme
    : DEFAULT_PROFILE_APPEARANCE.theme,
  avatarFrame: avatarFrames.has(value?.avatarFrame as AvatarFrame)
    ? value?.avatarFrame as AvatarFrame
    : DEFAULT_PROFILE_APPEARANCE.avatarFrame,
})

export const normalizeProfile = (profile: LocalProfile): LocalProfile => ({
  displayName: profile.displayName.trim().replace(/\s+/g, ' ').slice(0, 48),
  avatarDataUrl: isSafeAvatarDataUrl(profile.avatarDataUrl) ? profile.avatarDataUrl : undefined,
  bio: typeof profile.bio === 'string' ? profile.bio.trim().replace(/\s+/g, ' ').slice(0, 96) : undefined,
  appearance: normalizeProfileAppearance(profile.appearance),
})

const isSafeAvatarDataUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_PROFILE_AVATAR_DATA_URL_LENGTH &&
  /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(blob)
  })

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('A imagem não pôde ser aberta.'))
    }
    image.src = url
  })

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem.')),
      'image/webp',
      quality,
    )
  })

const prepareStaticAvatar = async (file: File) => {
  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  const size = 256
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Seu navegador não conseguiu preparar a imagem.')

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
  const sourceX = (image.naturalWidth - sourceSize) / 2
  const sourceY = (image.naturalHeight - sourceSize) / 2
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  )

  let blob = await canvasToBlob(canvas, 0.86)
  if (blob.size > 120 * 1024) blob = await canvasToBlob(canvas, 0.7)
  if (blob.size > 160 * 1024) {
    throw new Error('Não foi possível reduzir essa imagem. Escolha outra foto.')
  }
  return blobToDataUrl(blob)
}

export const prepareProfileAvatar = async (file: File) => {
  if (!supportedAvatarTypes.has(file.type)) {
    throw new Error('Use uma imagem PNG, JPG, WEBP ou GIF.')
  }
  if (file.size > MAX_PROFILE_SOURCE_BYTES) {
    throw new Error('A imagem original pode ter no máximo 8 MB.')
  }

  if (file.type === 'image/gif') {
    if (file.size > MAX_PROFILE_GIF_BYTES) {
      throw new Error('O GIF de perfil pode ter no máximo 300 KB para continuar animado.')
    }
    const dataUrl = await blobToDataUrl(file)
    if (!isSafeAvatarDataUrl(dataUrl)) throw new Error('Esse GIF não pôde ser usado.')
    return dataUrl
  }

  const dataUrl = await prepareStaticAvatar(file)
  if (!isSafeAvatarDataUrl(dataUrl)) throw new Error('Essa imagem não pôde ser usada.')
  return dataUrl
}

export const serializeParticipantProfile = (profile: LocalProfile) =>
  JSON.stringify({
    fordKallProfile: {
      version: PROFILE_METADATA_VERSION,
      avatarDataUrl: isSafeAvatarDataUrl(profile.avatarDataUrl)
        ? profile.avatarDataUrl
        : undefined,
      bio: typeof profile.bio === 'string' ? profile.bio.slice(0, 96) : undefined,
      appearance: normalizeProfileAppearance(profile.appearance),
    },
  })

export const participantProfileFromMetadata = (metadata?: string): ParticipantProfile => {
  const fallback = { appearance: DEFAULT_PROFILE_APPEARANCE }
  if (!metadata) return fallback
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (!parsed || typeof parsed !== 'object') return fallback
    const profile = (parsed as {
      fordKallProfile?: {
        version?: unknown
        avatarDataUrl?: unknown
        bio?: unknown
        appearance?: Partial<ProfileAppearance>
      }
    }).fordKallProfile
    if (!profile || (profile.version !== 1 && profile.version !== PROFILE_METADATA_VERSION)) return fallback
    return {
      avatarDataUrl: isSafeAvatarDataUrl(profile.avatarDataUrl) ? profile.avatarDataUrl : undefined,
      bio: typeof profile.bio === 'string' ? profile.bio.slice(0, 96) : undefined,
      appearance: normalizeProfileAppearance(profile.appearance),
    }
  } catch {
    return fallback
  }
}

export const participantAvatarFromMetadata = (metadata?: string) =>
  participantProfileFromMetadata(metadata).avatarDataUrl

export const profileAccent = (appearance?: Partial<ProfileAppearance>) =>
  PROFILE_THEME_COLORS[normalizeProfileAppearance(appearance).theme]
