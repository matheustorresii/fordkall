import {
  Room,
  VideoPreset,
  type TokenSourceResponseObject,
} from 'livekit-client'
import type { StreamQualityId } from '../types'
import type { LocalProfile } from '../types'
import { invokeFunction } from './supabase'

export const normalizeDisplayName = (value: string) => value.trim().replace(/\s+/g, ' ')

export const normalizeRoomCode = (value: string) =>
  value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()

export const roomCodeFromInput = (value: string) => {
  const trimmedValue = value.trim()
  if (!trimmedValue) return ''

  const roomQuery = trimmedValue.match(/[?&]room=([^&#]+)/i)?.[1]
  if (roomQuery) {
    try {
      return normalizeRoomCode(decodeURIComponent(roomQuery))
    } catch {
      return normalizeRoomCode(roomQuery)
    }
  }

  if (trimmedValue.toLocaleLowerCase().startsWith('fordkall://')) {
    try {
      const url = new URL(trimmedValue)
      const explicitRoom = url.searchParams.get('room')
      const routeRoom = url.hostname.toLocaleLowerCase() === 'join'
        ? url.pathname.replace(/^\/+/, '')
        : url.hostname
      return normalizeRoomCode(explicitRoom || routeRoom)
    } catch {
      return ''
    }
  }

  return normalizeRoomCode(trimmedValue)
}

export const getRoomCodeFromUrl = () => {
  if (typeof window === 'undefined') return ''
  const room = new URL(window.location.href).searchParams.get('room')
  return room ? normalizeRoomCode(room) : ''
}

export const createRoomInviteUrl = (roomCode: string) => {
  const normalizedRoom = normalizeRoomCode(roomCode)
  if (typeof window === 'undefined') return `?room=${encodeURIComponent(normalizedRoom)}`

  const url = new URL(
    window.fordKallDesktop ? 'https://fordkall.11a3.dev/' : window.location.href,
  )
  url.search = ''
  url.searchParams.set('room', normalizedRoom)
  url.hash = ''
  return url.toString()
}

export const replaceRoomCodeInCurrentUrl = (roomCode: string) => {
  if (typeof window === 'undefined') return
  const normalizedRoom = normalizeRoomCode(roomCode)
  const url = new URL(window.location.href)
  url.search = ''
  if (normalizedRoom) url.searchParams.set('room', normalizedRoom)
  url.hash = ''
  window.history.replaceState(null, '', url)
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const generateRoomCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const characters = [...bytes].map(
    (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length],
  )
  return `${characters.slice(0, 3).join('')}-${characters.slice(3, 7).join('')}-${characters.slice(7).join('')}`
}

export const createLiveKitRoom = () =>
  new Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
    webAudioMix: true,
  })

export const fetchConnectionDetails = async (
  roomCode: string,
  _profile: LocalProfile,
): Promise<TokenSourceResponseObject> => {
  return invokeFunction<TokenSourceResponseObject>('livekit-token', { roomCode })
}

export const streamQualityPresets: Record<
  StreamQualityId,
  { label: string; shortLabel: string; usageLabel: string; preset: VideoPreset }
> = {
  '720p30': {
    label: '720p · 30 FPS',
    shortLabel: '720p30',
    usageLabel: 'Menor consumo',
    preset: new VideoPreset(1280, 720, 2_500_000, 30),
  },
  '1080p30': {
    label: '1080p · 30 FPS',
    shortLabel: '1080p30',
    usageLabel: 'Equilibrado',
    preset: new VideoPreset(1920, 1080, 4_500_000, 30),
  },
  '1080p60': {
    label: '1080p · 60 FPS',
    shortLabel: '1080p60',
    usageLabel: 'Alto consumo',
    preset: new VideoPreset(1920, 1080, 7_000_000, 60),
  },
}

export const friendlyConnectionError = (error: unknown) => {
  if (error instanceof Error && error.message === 'ACCOUNT_SUSPENDED') return 'Sua conta foi suspensa e não pode entrar em calls.'
  if (error instanceof Error && error.message === 'TOKEN_RATE_LIMIT') return 'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.'
  if (error instanceof Error && error.message === 'LIVEKIT_NOT_CONFIGURED') return 'O servidor de chamadas ainda não recebeu as credenciais do LiveKit.'
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'O navegador bloqueou a permissão necessária. Revise as permissões do site.'
  }
  if (error instanceof Error && /token|credential|unauthorized|401|403/i.test(error.message)) {
    return 'Sua sessão não conseguiu autorização para entrar nessa sala. Faça login novamente.'
  }
  return 'Não foi possível entrar na call. Verifique sua conexão e tente novamente.'
}

export const friendlyMicrophoneError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return window.fordKallDesktop?.platform === 'win32'
      ? 'Permissão do microfone negada. Libere o acesso no Windows e clique no microfone para tentar novamente.'
      : 'Permissão do microfone negada. Você entrou apenas para ouvir.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'Nenhum microfone foi encontrado neste dispositivo.'
  }
  return 'Não foi possível iniciar o microfone. Você ainda pode ouvir a call.'
}
