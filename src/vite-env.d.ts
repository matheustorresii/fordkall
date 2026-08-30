/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface FordKallDesktopInfo {
  platform: string
  version: string
  publicAppUrl: string
}

interface FordKallOverlayParticipant {
  id: string
  name: string
  avatarDataUrl?: string
  isLocal: boolean
  muted: boolean
  speaking: boolean
}

interface FordKallOverlayState {
  enabled: boolean
  participants: FordKallOverlayParticipant[]
}

interface FordKallDesktopApi {
  readonly isDesktop: true
  readonly platform: string
  minimize: () => void
  openMicrophoneSettings: () => void
  setInCall: (inCall: boolean) => void
  setGameOverlayState: (state: FordKallOverlayState) => void
  setGameOverlaySpeakers: (participantIds: string[]) => void
  setShortcutBindings: (bindings: import('./types').ShortcutBindings) => void
  setShortcutCaptureActive: (active: boolean) => void
  getUpdateState: () => Promise<import('./types').AppUpdateState>
  checkForUpdates: () => Promise<import('./types').AppUpdateState>
  installUpdate: () => void
  getInfo: () => Promise<FordKallDesktopInfo | null>
  onOpenRoom: (listener: (roomCode: string) => void) => () => void
  onShortcut: (listener: (action: import('./types').ShortcutAction) => void) => () => void
  onShortcutStatus: (listener: (status: { failedActions: import('./types').ShortcutAction[] }) => void) => () => void
  onUpdateState: (listener: (state: import('./types').AppUpdateState) => void) => () => void
}

interface Window {
  readonly fordKallDesktop?: FordKallDesktopApi
}
