export interface MicrophoneCaptureSettings {
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
}

export type MicrophonePreset = 'natural' | 'noise' | 'unprocessed'
export const MICROPHONE_SENSITIVITY_MIN_DB = -70
export const MICROPHONE_SENSITIVITY_MAX_DB = -20
export const DEFAULT_MICROPHONE_SENSITIVITY_DB = -48

export const microphonePresets: Record<MicrophonePreset, MicrophoneCaptureSettings> = {
  natural: { noiseSuppression: false, echoCancellation: true, autoGainControl: false },
  noise: { noiseSuppression: true, echoCancellation: true, autoGainControl: false },
  unprocessed: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
}

export const microphoneConstraints = (settings: MicrophoneCaptureSettings) => ({
  noiseSuppression: settings.noiseSuppression,
  echoCancellation: settings.echoCancellation,
  autoGainControl: settings.autoGainControl,
  // LiveKit otherwise defaults this stronger filter to true. It can override
  // noiseSuppression:false on supported browsers, defeating the visible switch.
  voiceIsolation: false,
})

export const microphonePresetFor = (settings: MicrophoneCaptureSettings, sensitivityEnabled: boolean): MicrophonePreset | 'custom' => {
  if (sensitivityEnabled) return 'custom'
  return (Object.keys(microphonePresets) as MicrophonePreset[]).find((id) =>
    (Object.keys(settings) as Array<keyof MicrophoneCaptureSettings>).every((key) => settings[key] === microphonePresets[id][key]),
  ) ?? 'custom'
}

export const clampMicrophoneThreshold = (value: number) => Number.isFinite(value)
  ? Math.round(Math.min(MICROPHONE_SENSITIVITY_MAX_DB, Math.max(MICROPHONE_SENSITIVITY_MIN_DB, value)))
  : DEFAULT_MICROPHONE_SENSITIVITY_DB
