import type {
  AudioChannel,
  DevicePreferences,
  GalleryLayoutMode,
  LocalProfile,
  ShortcutBindings,
  StreamQualityId,
} from '../types'
import { normalizeProfileAppearance } from '../services/profile'
import { clampMicrophoneThreshold, DEFAULT_MICROPHONE_SENSITIVITY_DB } from '../services/microphoneSettings'
export { MICROPHONE_SENSITIVITY_MIN_DB, MICROPHONE_SENSITIVITY_MAX_DB, DEFAULT_MICROPHONE_SENSITIVITY_DB } from '../services/microphoneSettings'

const DISPLAY_NAME_KEY = 'ford-kall:display-name'
const LOCAL_PROFILE_KEY = 'ford-kall:local-profile'
const VOLUMES_KEY = 'ford-kall:participant-volumes'
const DEVICES_KEY = 'ford-kall:devices'
const QUALITY_KEY = 'ford-kall:stream-quality'
const NOISE_SUPPRESSION_KEY = 'ford-kall:noise-suppression'
const ECHO_CANCELLATION_KEY = 'ford-kall:echo-cancellation'
const AUTO_GAIN_CONTROL_KEY = 'ford-kall:auto-gain-control'
const MICROPHONE_SENSITIVITY_ENABLED_KEY = 'ford-kall:microphone-sensitivity-enabled'
const MICROPHONE_SENSITIVITY_THRESHOLD_KEY = 'ford-kall:microphone-sensitivity-threshold'
const GALLERY_LAYOUT_KEY = 'ford-kall:gallery-layout'
const CALL_SOUNDS_KEY = 'ford-kall:call-sounds'
const MICROPHONE_MONITOR_VOLUME_KEY = 'ford-kall:microphone-monitor-volume'
const GAME_OVERLAY_KEY = 'ford-kall:game-overlay'
const SHORTCUT_BINDINGS_KEY = 'ford-kall:shortcut-bindings'
const ROOM_MUSIC_VOLUME_KEY = 'ford-kall:room-music-volume'
const ROOM_MUSIC_LISTENING_KEY = 'ford-kall:room-music-listening'
export type PerformanceMode = 'gaming' | 'balanced'
export const getPerformanceMode = (): PerformanceMode => safeRead('ford-kall:performance-mode') === 'balanced' ? 'balanced' : 'gaming'
export const savePerformanceMode = (mode: PerformanceMode) => safeWrite('ford-kall:performance-mode', mode)

export const MAX_PARTICIPANT_VOLUME = 6
export const PARTICIPANT_VOLUME_EVENT = 'ford-kall:participant-volume'

const safeRead = (key: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const safeWrite = (key: string, value: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }
}

export const getLocalProfile = (): LocalProfile => {
  const stored = safeRead(LOCAL_PROFILE_KEY)
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored)
      if (parsed && typeof parsed === 'object') {
        const profile = parsed as Partial<LocalProfile>
        return {
          displayName: typeof profile.displayName === 'string' ? profile.displayName : '',
          avatarDataUrl: typeof profile.avatarDataUrl === 'string'
            ? profile.avatarDataUrl
            : undefined,
          bio: typeof profile.bio === 'string' ? profile.bio : undefined,
          appearance: normalizeProfileAppearance(profile.appearance),
        }
      }
    } catch {
      // Fall through to the legacy display-name preference.
    }
  }
  return { displayName: safeRead(DISPLAY_NAME_KEY) ?? '', appearance: normalizeProfileAppearance() }
}

export const saveLocalProfile = (profile: LocalProfile) => {
  safeWrite(LOCAL_PROFILE_KEY, JSON.stringify(profile))
  safeWrite(DISPLAY_NAME_KEY, profile.displayName)
}

export const getDisplayName = () => getLocalProfile().displayName

export const saveDisplayName = (name: string) => {
  saveLocalProfile({ ...getLocalProfile(), displayName: name })
}

const volumeKey = (participantName: string, channel: AudioChannel) =>
  `${participantName.trim().toLocaleLowerCase()}:${channel}`

const readVolumes = (): Record<string, number> => {
  const stored = safeRead(VOLUMES_KEY)
  if (!stored) return {}

  try {
    const parsed: unknown = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export const getParticipantVolume = (participantName: string, channel: AudioChannel) => {
  const volume = readVolumes()[volumeKey(participantName, channel)]
  return typeof volume === 'number' && Number.isFinite(volume)
    ? Math.min(MAX_PARTICIPANT_VOLUME, Math.max(0, volume))
    : channel === 'screen'
      ? 0.85
      : 0.8
}

export const saveParticipantVolume = (
  participantName: string,
  channel: AudioChannel,
  volume: number,
) => {
  const volumes = readVolumes()
  volumes[volumeKey(participantName, channel)] = Math.min(
    MAX_PARTICIPANT_VOLUME,
    Math.max(0, volume),
  )
  safeWrite(VOLUMES_KEY, JSON.stringify(volumes))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PARTICIPANT_VOLUME_EVENT, {
        detail: { participantName, channel, volume: volumes[volumeKey(participantName, channel)] },
      }),
    )
  }
}

const defaultDevices: DevicePreferences = {
  inputId: '',
  videoInputId: '',
  voiceOutputId: '',
  screenOutputId: '',
}

export const getDevicePreferences = (): DevicePreferences => {
  const stored = safeRead(DEVICES_KEY)
  if (!stored) return defaultDevices

  try {
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return defaultDevices
    return { ...defaultDevices, ...(parsed as Partial<DevicePreferences>) }
  } catch {
    return defaultDevices
  }
}

export const saveDevicePreferences = (preferences: DevicePreferences) =>
  safeWrite(DEVICES_KEY, JSON.stringify(preferences))

export const getStreamQuality = (): StreamQualityId => {
  const quality = safeRead(QUALITY_KEY)
  return quality === '720p30' || quality === '1080p60' ? quality : '1080p30'
}

export const saveStreamQuality = (quality: StreamQualityId) =>
  safeWrite(QUALITY_KEY, quality)

export const getNoiseSuppression = () => safeRead(NOISE_SUPPRESSION_KEY) === 'true'

export const saveNoiseSuppression = (enabled: boolean) =>
  safeWrite(NOISE_SUPPRESSION_KEY, String(enabled))

export const getEchoCancellation = () => safeRead(ECHO_CANCELLATION_KEY) !== 'false'
export const saveEchoCancellation = (enabled: boolean) => safeWrite(ECHO_CANCELLATION_KEY, String(enabled))
export const getAutoGainControl = () => safeRead(AUTO_GAIN_CONTROL_KEY) === 'true'
export const saveAutoGainControl = (enabled: boolean) => safeWrite(AUTO_GAIN_CONTROL_KEY, String(enabled))
export const getMicrophoneCaptureSettings = () => ({ noiseSuppression: getNoiseSuppression(), echoCancellation: getEchoCancellation(), autoGainControl: getAutoGainControl() })

export const getMicrophoneSensitivityEnabled = () =>
  safeRead(MICROPHONE_SENSITIVITY_ENABLED_KEY) === 'true'

export const saveMicrophoneSensitivityEnabled = (enabled: boolean) =>
  safeWrite(MICROPHONE_SENSITIVITY_ENABLED_KEY, String(enabled))

export const getMicrophoneSensitivityThreshold = () => {
  const raw = safeRead(MICROPHONE_SENSITIVITY_THRESHOLD_KEY)
  if (raw === null) return DEFAULT_MICROPHONE_SENSITIVITY_DB
  return clampMicrophoneThreshold(Number(raw))
}

export const saveMicrophoneSensitivityThreshold = (thresholdDb: number) =>
  safeWrite(
    MICROPHONE_SENSITIVITY_THRESHOLD_KEY,
    String(clampMicrophoneThreshold(thresholdDb)),
  )

export const getGalleryLayout = (): GalleryLayoutMode =>
  safeRead(GALLERY_LAYOUT_KEY) === 'cinema' ? 'cinema' : 'expanded'

export const saveGalleryLayout = (layout: GalleryLayoutMode) =>
  safeWrite(GALLERY_LAYOUT_KEY, layout)

export const getCallSoundsEnabled = () => safeRead(CALL_SOUNDS_KEY) !== 'false'

export const saveCallSoundsEnabled = (enabled: boolean) =>
  safeWrite(CALL_SOUNDS_KEY, String(enabled))

export const getMicrophoneMonitorVolume = () => {
  const raw = safeRead(MICROPHONE_MONITOR_VOLUME_KEY)
  if (raw === null) return 1
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.min(2, Math.max(0, stored)) : 1
}

export const saveMicrophoneMonitorVolume = (volume: number) =>
  safeWrite(MICROPHONE_MONITOR_VOLUME_KEY, String(Math.min(2, Math.max(0, volume))))

export const getRoomMusicVolume = () => {
  const raw = safeRead(ROOM_MUSIC_VOLUME_KEY)
  if (raw === null) return 70
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 70
}

export const getRoomMusicListening = () => safeRead(ROOM_MUSIC_LISTENING_KEY) !== 'false'
export const saveRoomMusicListening = (enabled: boolean) => safeWrite(ROOM_MUSIC_LISTENING_KEY, String(enabled))

export const saveRoomMusicVolume = (volume: number) =>
  safeWrite(ROOM_MUSIC_VOLUME_KEY, String(Math.min(100, Math.max(0, volume))))

export const getGameOverlayEnabled = () => safeRead(GAME_OVERLAY_KEY) === 'true'

export const saveGameOverlayEnabled = (enabled: boolean) =>
  safeWrite(GAME_OVERLAY_KEY, String(enabled))

const emptyShortcutBindings = (): ShortcutBindings => ({
  microphone: '',
  deafen: '',
  camera: '',
  screenShare: '',
  leave: '',
})

export const getShortcutBindings = (): ShortcutBindings => {
  const defaults = emptyShortcutBindings()
  const stored = safeRead(SHORTCUT_BINDINGS_KEY)
  if (!stored) return defaults

  try {
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return defaults
    const values = parsed as Partial<Record<keyof ShortcutBindings, unknown>>
    return Object.fromEntries(
      Object.keys(defaults).map((action) => [
        action,
        typeof values[action as keyof ShortcutBindings] === 'string'
          ? String(values[action as keyof ShortcutBindings]).slice(0, 64)
          : '',
      ]),
    ) as ShortcutBindings
  } catch {
    return defaults
  }
}

export const saveShortcutBindings = (bindings: ShortcutBindings) =>
  safeWrite(SHORTCUT_BINDINGS_KEY, JSON.stringify(bindings))
