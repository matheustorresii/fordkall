const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  Tray,
} = require('electron')
const { autoUpdater } = require('electron-updater')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const APP_ID = 'dev.11a3.fordkall'
const APP_SCHEME = 'fordkall-app'
const APP_ORIGIN = `${APP_SCHEME}://app`
const PICKER_ORIGIN = `${APP_SCHEME}://picker`
const OVERLAY_ORIGIN = `${APP_SCHEME}://overlay`
const PUBLIC_APP_URL = 'https://fordkall.11a3.dev/'
const DEV_SERVER_URL = 'http://127.0.0.1:5173'
const isDevelopment = process.argv.includes('--dev') || !app.isPackaged

let mainWindow = null
let updateSplashWindow = null
let tray = null
let isQuitting = false
let isInCall = false
let trayHintShown = false
let pendingRoomCode = ''
let activePicker = null
let overlayWindow = null
let overlayTargetBounds = null
let gameWatcher = null
let gameWatcherBuffer = ''
let gameWatcherRestartTimer = null
let overlayState = { enabled: false, participants: [] }
let shortcutBindings = {}
let shortcutCaptureActive = false
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  message: 'As atualizações são verificadas automaticamente ao abrir o app.',
}
let updateInstallStarted = false
let updateInstallTimer = null
let startupUpdateGateActive = false
let startupUpdateGateStartedAt = 0
let startupUpdateGateTimer = null
let startupUpdateCheckTimeout = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
      stream: true,
    },
  },
])

app.setAppUserModelId(APP_ID)

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

const normalizeRoomCode = (value) =>
  value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()

const roomCodeFromDeepLink = (value) => {
  if (typeof value !== 'string' || !value.toLowerCase().startsWith('fordkall://')) return ''
  try {
    const url = new URL(value)
    const explicitRoom = url.searchParams.get('room')
    if (explicitRoom) return normalizeRoomCode(explicitRoom)

    const routeRoom = url.hostname.toLowerCase() === 'join'
      ? url.pathname.replace(/^\/+/, '')
      : url.hostname
    return normalizeRoomCode(routeRoom)
  } catch {
    return ''
  }
}

const findRoomCodeInArguments = (argumentsList) => {
  for (const argument of argumentsList) {
    const roomCode = roomCodeFromDeepLink(argument)
    if (roomCode) return roomCode
  }
  return ''
}

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!updateSplashWindow || updateSplashWindow.isDestroyed()) return
    if (updateSplashWindow.isMinimized()) updateSplashWindow.restore()
    updateSplashWindow.show()
    updateSplashWindow.focus()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const sendRoomCode = (roomCode) => {
  const normalizedRoom = normalizeRoomCode(roomCode)
  if (!normalizedRoom) return
  pendingRoomCode = normalizedRoom
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('desktop:open-room', normalizedRoom)
  pendingRoomCode = ''
}

app.on('second-instance', (_event, commandLine) => {
  showMainWindow()
  const roomCode = findRoomCodeInArguments(commandLine)
  if (roomCode) sendRoomCode(roomCode)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  const roomCode = roomCodeFromDeepLink(url)
  if (roomCode) sendRoomCode(roomCode)
})

const iconPath = () => app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-assets', 'icon.png')
  : path.join(__dirname, '..', 'build', 'icon.png')

const isTrustedRendererUrl = (value) => {
  try {
    const url = new URL(value)
    if (!isDevelopment && url.protocol === `${APP_SCHEME}:` && url.hostname === 'app') {
      return true
    }
    if (isDevelopment) {
      return url.origin === DEV_SERVER_URL || url.origin === 'http://localhost:5173'
    }
    return false
  } catch {
    return false
  }
}

const hasTrustedRendererUrl = (...values) => values.some((value) =>
  typeof value === 'string' && isTrustedRendererUrl(value),
)

const contentTypeFor = (filePath) => {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[extension] || 'application/octet-stream'
}

const installAppProtocol = () => {
  const rendererRoot = path.resolve(app.getAppPath(), 'dist')
  const electronRoot = path.resolve(app.getAppPath(), 'electron')
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const resourceRoot = url.hostname === 'app'
        ? rendererRoot
        : url.hostname === 'picker' || url.hostname === 'overlay'
          ? electronRoot
          : null
      if (!resourceRoot) return new Response('Not found', { status: 404 })

      let pathname = decodeURIComponent(url.pathname)
      if (!pathname || pathname === '/') {
        pathname = url.hostname === 'picker'
          ? '/screen-picker.html'
          : url.hostname === 'overlay'
            ? '/game-overlay.html'
            : '/index.html'
      }

      const filePath = path.resolve(resourceRoot, `.${pathname}`)
      if (filePath !== resourceRoot && !filePath.startsWith(`${resourceRoot}${path.sep}`)) {
        return new Response('Not found', { status: 404 })
      }

      const data = await fs.readFile(filePath)
      const headers = new Headers({
        'Content-Type': contentTypeFor(filePath),
        'Cross-Origin-Resource-Policy': 'same-site',
      })
      if (path.extname(filePath).toLowerCase() === '.html') {
        if (url.hostname === 'app') {
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; frame-src 'self' blob: about: https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'",
          )
          headers.set(
            'Permissions-Policy',
            'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), picture-in-picture=(self), autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")',
          )
        } else {
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
          )
        }
      }
      return new Response(data, { status: 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

const finishPicker = (result) => {
  const picker = activePicker
  if (!picker) return
  activePicker = null
  picker.resolve(result)
  if (!picker.window.isDestroyed()) picker.window.close()
}

const openCapturePicker = async () => {
  if (activePicker) finishPicker(null)

  const ownSourceIds = new Set()
  if (mainWindow && !mainWindow.isDestroyed()) {
    ownSourceIds.add(mainWindow.getMediaSourceId())
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    ownSourceIds.add(overlayWindow.getMediaSourceId())
  }

  const sources = (await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 225 },
    fetchWindowIcons: true,
  }))
    .filter((source) => !ownSourceIds.has(source.id))
    .sort((left, right) => Number(right.id.startsWith('screen:')) - Number(left.id.startsWith('screen:')))

  if (!sources.length) return null

  const pickerWindow = new BrowserWindow({
    width: 980,
    height: 690,
    minWidth: 720,
    minHeight: 520,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    title: 'Escolher o que compartilhar · Ford Kall',
    icon: iconPath(),
    backgroundColor: '#080a09',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const result = new Promise((resolve) => {
    activePicker = { window: pickerWindow, sources, resolve }
  })

  pickerWindow.once('ready-to-show', () => pickerWindow.show())
  pickerWindow.once('closed', () => {
    if (activePicker?.window === pickerWindow) finishPicker(null)
  })
  pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pickerWindow.webContents.on('will-navigate', (event, url) => {
    const allowedUrl = isDevelopment
      ? url.startsWith('file:')
      : url.startsWith(`${PICKER_ORIGIN}/`)
    if (!allowedUrl) event.preventDefault()
  })

  try {
    if (isDevelopment) {
      await pickerWindow.loadFile(path.join(__dirname, 'screen-picker.html'))
    } else {
      await pickerWindow.loadURL(`${PICKER_ORIGIN}/screen-picker.html`)
    }
  } catch (error) {
    if (activePicker?.window === pickerWindow) finishPicker(null)
    throw error
  }
  return result
}

const rejectDisplayRequest = (callback) => {
  try {
    void Promise.resolve(callback({})).catch(() => undefined)
  } catch {
    // The renderer receives NotAllowedError when Chromium rejects the request.
  }
}

const installCapturePicker = () => {
  ipcMain.handle('capture-picker:list', (event) => {
    if (!activePicker || event.sender !== activePicker.window.webContents) return []
    return activePicker.sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.isEmpty() === false ? source.appIcon.toDataURL() : '',
    }))
  })

  ipcMain.on('capture-picker:select', (event, selection) => {
    if (!activePicker || event.sender !== activePicker.window.webContents) return
    const source = activePicker.sources.find((candidate) => candidate.id === selection?.id)
    if (!source) return
    finishPicker({
      source,
      withAudio: process.platform === 'win32' && selection?.withAudio !== false,
    })
  })

  ipcMain.on('capture-picker:cancel', (event) => {
    if (!activePicker || event.sender !== activePicker.window.webContents) return
    finishPicker(null)
  })
}

const installSessionSecurity = () => {
  const appSession = session.defaultSession
  appSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://youtube.com/*',
        'https://*.youtube.com/*',
        'https://youtube-nocookie.com/*',
        'https://*.youtube-nocookie.com/*',
      ],
    },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          Referer: PUBLIC_APP_URL,
        },
      })
    },
  )
  const allowedPermissions = new Set([
    'clipboard-sanitized-write',
    'display-capture',
    'fullscreen',
    'media',
  ])

  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const trusted = hasTrustedRendererUrl(
      details.requestingUrl,
      details.securityOrigin,
      requestingOrigin,
      webContents?.getURL(),
    )
    return allowedPermissions.has(permission) && trusted
  })

  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = hasTrustedRendererUrl(
      details.requestingUrl,
      details.securityOrigin,
      webContents.getURL(),
    )
    callback(allowedPermissions.has(permission) && trusted)
  })

  appSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const trusted = hasTrustedRendererUrl(
      request.securityOrigin,
      request.frame?.url,
      request.frame?.origin,
    )
    if (!trusted) {
      rejectDisplayRequest(callback)
      return
    }

    try {
      const selection = await openCapturePicker()
      if (!selection) {
        rejectDisplayRequest(callback)
        return
      }

      callback({
        video: selection.source,
        ...(request.audioRequested && selection.withAudio ? { audio: 'loopback' } : {}),
      })
    } catch {
      rejectDisplayRequest(callback)
    }
  })
}

const excludedOverlayProcesses = new Set([
  'applicationframehost',
  'brave',
  'chrome',
  'code',
  'discord',
  'dwm',
  'electron',
  'explorer',
  'firefox',
  'ford kall',
  'msedge',
  'opera',
  'searchhost',
  'shellexperiencehost',
  'startmenuexperiencehost',
  'vivaldi',
])

const foregroundWatcherScript = String.raw`
$source = @'
using System;
using System.Runtime.InteropServices;
public static class FordKallForegroundWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
Add-Type -TypeDefinition $source
while ($true) {
  $handle = [FordKallForegroundWindow]::GetForegroundWindow()
  $rect = New-Object FordKallForegroundWindow+RECT
  $processId = [uint32]0
  if ($handle -ne [IntPtr]::Zero -and [FordKallForegroundWindow]::GetWindowRect($handle, [ref]$rect)) {
    [void][FordKallForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    $processName = ''
    try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
    [PSCustomObject]@{
      x = $rect.Left
      y = $rect.Top
      width = $rect.Right - $rect.Left
      height = $rect.Bottom - $rect.Top
      process = $processName
    } | ConvertTo-Json -Compress
  }
  Start-Sleep -Milliseconds 850
}
`

const sanitizeOverlayState = (value) => ({
  enabled: value?.enabled === true,
  participants: Array.isArray(value?.participants)
    ? value.participants.slice(0, 8).map((participant, index) => ({
        id: String(participant?.id || index).slice(0, 128),
        name: String(participant?.name || 'Participante').slice(0, 64),
        avatarDataUrl:
          typeof participant?.avatarDataUrl === 'string' &&
          participant.avatarDataUrl.length <= 430_000 &&
          /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(participant.avatarDataUrl)
            ? participant.avatarDataUrl
            : undefined,
        isLocal: participant?.isLocal === true,
        muted: participant?.muted !== false,
        speaking: participant?.speaking === true,
      }))
    : [],
})

const destroyGameOverlay = () => {
  overlayTargetBounds = null
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = null
    return
  }
  const window = overlayWindow
  overlayWindow = null
  window.destroy()
}

const ensureGameOverlay = () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow

  const window = new BrowserWindow({
    width: 216,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  overlayWindow = window
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setIgnoreMouseEvents(true, { forward: false })
  window.setContentProtection(true)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const allowedUrl = isDevelopment
      ? url.startsWith('file:')
      : url.startsWith(`${OVERLAY_ORIGIN}/`)
    if (!allowedUrl) event.preventDefault()
  })
  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed()) return
    window.webContents.send('game-overlay:state', overlayState)
    if (overlayTargetBounds) {
      window.setBounds(overlayTargetBounds)
      window.showInactive()
      window.moveTop()
    }
  })
  window.on('closed', () => {
    if (overlayWindow === window) overlayWindow = null
  })

  if (isDevelopment) {
    void window.loadFile(path.join(__dirname, 'game-overlay.html'))
  } else {
    void window.loadURL(`${OVERLAY_ORIGIN}/game-overlay.html`)
  }
  return window
}

const hideGameOverlay = () => {
  overlayTargetBounds = null
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
}

const showGameOverlay = (display) => {
  const rowCount = Math.max(1, Math.min(8, overlayState.participants.length))
  overlayTargetBounds = {
    x: display.bounds.x + 10,
    y: display.bounds.y + 10,
    width: 216,
    height: Math.min(300, 12 + rowCount * 34),
  }
  const window = ensureGameOverlay()
  window.setBounds(overlayTargetBounds)
  if (!window.webContents.isLoading()) {
    window.showInactive()
    window.moveTop()
  }
}

const updateOverlayForForegroundWindow = (foreground) => {
  if (!overlayState.enabled || !isInCall || !overlayState.participants.length) {
    hideGameOverlay()
    return
  }

  const bounds = {
    x: Math.round(Number(foreground?.x) || 0),
    y: Math.round(Number(foreground?.y) || 0),
    width: Math.max(0, Math.round(Number(foreground?.width) || 0)),
    height: Math.max(0, Math.round(Number(foreground?.height) || 0)),
  }
  const processName = String(foreground?.process || '').toLocaleLowerCase()
  if (!bounds.width || !bounds.height || excludedOverlayProcesses.has(processName)) {
    hideGameOverlay()
    return
  }

  const display = screen.getDisplayMatching(bounds)
  const widthCoverage = bounds.width / display.bounds.width
  const heightCoverage = bounds.height / display.bounds.height
  const nearDisplayOrigin =
    Math.abs(bounds.x - display.bounds.x) <= 40 &&
    Math.abs(bounds.y - display.bounds.y) <= 40
  const isFullscreenOrBorderless =
    nearDisplayOrigin && widthCoverage >= 0.9 && heightCoverage >= 0.88

  if (isFullscreenOrBorderless) showGameOverlay(display)
  else hideGameOverlay()
}

const stopGameWatcher = () => {
  if (gameWatcherRestartTimer) {
    clearTimeout(gameWatcherRestartTimer)
    gameWatcherRestartTimer = null
  }
  if (gameWatcher) {
    const watcher = gameWatcher
    gameWatcher = null
    watcher.kill()
  }
  gameWatcherBuffer = ''
  hideGameOverlay()
}

const shouldRunGameWatcher = () =>
  process.platform === 'win32' && overlayState.enabled && isInCall

const startGameWatcher = () => {
  if (!shouldRunGameWatcher() || gameWatcher) return
  const watcher = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
    foregroundWatcherScript,
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  gameWatcher = watcher

  watcher.stdout.setEncoding('utf8')
  watcher.stdout.on('data', (chunk) => {
    gameWatcherBuffer += chunk
    const lines = gameWatcherBuffer.split(/\r?\n/)
    gameWatcherBuffer = lines.pop() || ''
    lines.forEach((line) => {
      try {
        updateOverlayForForegroundWindow(JSON.parse(line))
      } catch {
        // Ignore incomplete or unexpected PowerShell output.
      }
    })
  })
  watcher.on('error', () => undefined)
  watcher.on('close', () => {
    if (gameWatcher === watcher) gameWatcher = null
    hideGameOverlay()
    if (shouldRunGameWatcher() && !gameWatcherRestartTimer) {
      gameWatcherRestartTimer = setTimeout(() => {
        gameWatcherRestartTimer = null
        startGameWatcher()
      }, 2000)
    }
  })
}

const syncGameOverlayRuntime = () => {
  if (shouldRunGameWatcher()) {
    startGameWatcher()
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('game-overlay:state', overlayState)
    }
    return
  }
  stopGameWatcher()
  destroyGameOverlay()
}

const shortcutActions = ['microphone', 'deafen', 'camera', 'screenShare', 'leave']
const shortcutPattern = /^(?:(?:Control|Alt|Shift|Super)\+)*(?:F(?:[1-9]|1\d|2[0-4])|[A-Z0-9]|Space|Up|Down|Left|Right|PageUp|PageDown|Home|End|Insert|Enter|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Escape|num[0-9]|numdec|numadd|numsub|nummult|numdiv|[;=,./`\[\]\\-])$/

const sanitizeShortcutBindings = (value) => Object.fromEntries(
  shortcutActions.map((action) => {
    const binding = typeof value?.[action] === 'string' ? value[action].slice(0, 64) : ''
    return [action, shortcutPattern.test(binding) ? binding : '']
  }),
)

const sendShortcutStatus = (failedActions = []) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('desktop:shortcut-status', { failedActions })
}

const syncGlobalShortcuts = () => {
  globalShortcut.unregisterAll()
  if (!isInCall || shortcutCaptureActive) {
    sendShortcutStatus([])
    return
  }

  const failedActions = []
  for (const action of shortcutActions) {
    const binding = shortcutBindings[action]
    if (!binding) continue
    const registered = globalShortcut.register(binding, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('desktop:shortcut', action)
    })
    if (!registered) failedActions.push(action)
  }
  sendShortcutStatus(failedActions)
}

const isPortableWindowsApp = () =>
  Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR)

const autoUpdateSupported = () =>
  process.platform === 'win32' && app.isPackaged && !isPortableWindowsApp()

const unsupportedUpdateMessage = () => {
  if (isPortableWindowsApp()) {
    return 'A versão portátil não se atualiza sozinha. Instale a versão Setup para ativar updates.'
  }
  if (process.platform === 'darwin') {
    return 'No macOS, a atualização automática exige assinatura Apple. Instale manualmente a versão mais recente.'
  }
  return 'A atualização automática fica disponível no aplicativo Windows instalado.'
}

const updateSplashHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ford Kall</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { align-items: center; background: radial-gradient(ellipse at 50% 0%, #182016 0%, #0a0d0a 58%, #080a08 100%); color: #edf0eb; display: flex; height: 100vh; justify-content: center; margin: 0; overflow: hidden; user-select: none; }
    main { width: 100%; padding: 30px 34px 26px; }
    .brand { align-items: center; display: flex; gap: 11px; }
    .mark { align-items: center; background: #b9ef45; border-radius: 10px; color: #17200c; display: flex; height: 36px; justify-content: center; width: 36px; }
    .mark svg { height: 24px; width: 24px; }
    .brand-name { font-size: 12px; font-weight: 750; letter-spacing: .12em; }
    .brand-subtitle { color: #778077; font-size: 10px; letter-spacing: .09em; margin-top: 3px; }
    .content { margin-top: 38px; }
    .state { align-items: center; color: #b9ef45; display: flex; font-size: 10px; font-weight: 700; gap: 8px; letter-spacing: .11em; text-transform: uppercase; }
    .spinner { animation: spin .85s linear infinite; border: 1.5px solid rgba(185, 239, 69, .22); border-radius: 50%; border-top-color: #b9ef45; height: 14px; width: 14px; }
    .spinner.is-complete { animation: none; border-color: #b9ef45; position: relative; }
    .spinner.is-complete::after { border-bottom: 1.5px solid #b9ef45; border-right: 1.5px solid #b9ef45; content: ""; height: 6px; left: 3px; position: absolute; top: 2px; transform: rotate(45deg); width: 3px; }
    h1 { font-size: 21px; font-weight: 650; letter-spacing: -.025em; margin: 14px 0 7px; }
    p { color: #909990; font-size: 12px; line-height: 1.55; margin: 0; min-height: 19px; }
    .progress { background: #252c24; border-radius: 99px; height: 4px; margin-top: 22px; overflow: hidden; }
    .progress[hidden] { display: none; }
    .progress i { background: #b9ef45; border-radius: inherit; display: block; height: 100%; transition: width .2s ease; width: 0; }
    footer { border-top: 1px solid #202620; color: #687168; font-size: 10px; letter-spacing: .025em; margin-top: 28px; padding-top: 15px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main aria-live="polite" aria-atomic="true">
    <div class="brand">
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 14.5 4.6 10a2 2 0 0 1 1.9-1.4h11a2 2 0 0 1 1.9 1.4l1.6 4.5v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5 14.5h14M7 11h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="15" r=".8" fill="currentColor"/><circle cx="17" cy="15" r=".8" fill="currentColor"/></svg>
      </div>
      <div><div class="brand-name">FORD KALL</div><div class="brand-subtitle">CALLS, SEM COMPLICAÇÃO</div></div>
    </div>
    <section class="content">
      <div class="state"><span id="state-icon" class="spinner"></span><span id="state-label">BUSCANDO ATUALIZAÇÕES</span></div>
      <h1 id="state-title">Buscando atualizações</h1>
      <p id="state-message">Verificando se há uma versão mais recente.</p>
      <div id="progress" class="progress" hidden><i id="progress-bar"></i></div>
    </section>
    <footer>As atualizações são verificadas automaticamente ao abrir o aplicativo.</footer>
  </main>
  <script>
    window.updateFordKallStatus = (state) => {
      const title = document.getElementById('state-title')
      const message = document.getElementById('state-message')
      const label = document.getElementById('state-label')
      const icon = document.getElementById('state-icon')
      const progress = document.getElementById('progress')
      const bar = document.getElementById('progress-bar')
      const downloading = state.status === 'downloading'
      const labels = {
        checking: ['BUSCANDO ATUALIZAÇÕES', 'Verificando se há uma versão mais recente.'],
        downloading: ['ATUALIZAÇÃO ENCONTRADA', 'Baixando Ford Kall ' + (state.availableVersion || '') + '…'],
        ready: ['ATUALIZAÇÃO BAIXADA', 'Preparando o reinício para instalar a versão mais recente…'],
        installing: ['INSTALANDO ATUALIZAÇÃO', 'O Ford Kall será reiniciado em instantes.'],
        upToDate: ['TUDO ATUALIZADO', 'Abrindo o Ford Kall…'],
        error: ['SEGUINDO COM A VERSÃO ATUAL', 'Não foi possível verificar agora. Abrindo o Ford Kall…'],
      }
      const copy = labels[state.status] || labels.checking
      label.textContent = copy[0]
      title.textContent = state.status === 'downloading' ? 'Baixando atualização' : state.status === 'installing' ? 'Instalando atualização' : state.status === 'upToDate' ? 'Tudo pronto' : state.status === 'error' ? 'Abrindo o aplicativo' : state.status === 'ready' ? 'Atualização pronta' : 'Buscando atualizações'
      message.textContent = downloading ? copy[1] + ' ' + Math.round(state.percent || 0) + '%' : copy[1]
      progress.hidden = !downloading
      if (downloading) bar.style.width = Math.max(0, Math.min(100, state.percent || 0)) + '%'
      icon.classList.toggle('is-complete', state.status === 'upToDate' || state.status === 'error')
    }
  </script>
</body>
</html>`

const renderUpdateSplashState = (state = updateState) => {
  if (!updateSplashWindow || updateSplashWindow.isDestroyed()) return
  const serializedState = JSON.stringify(state)
  void updateSplashWindow.webContents.executeJavaScript(
    `window.updateFordKallStatus?.(${serializedState})`,
  ).catch(() => {})
}

const createUpdateSplashWindow = async () => {
  if (updateSplashWindow && !updateSplashWindow.isDestroyed()) return

  const splash = new BrowserWindow({
    width: 460,
    height: 310,
    center: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'Ford Kall',
    icon: iconPath(),
    backgroundColor: '#080a08',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  updateSplashWindow = splash
  splash.once('ready-to-show', () => {
    if (startupUpdateGateActive && updateSplashWindow === splash) splash.show()
  })
  splash.webContents.on('did-finish-load', () => renderUpdateSplashState())
  splash.on('close', () => {
    if (!startupUpdateGateActive || isQuitting) return
    startupUpdateGateActive = false
    if (startupUpdateGateTimer) clearTimeout(startupUpdateGateTimer)
    if (startupUpdateCheckTimeout) clearTimeout(startupUpdateCheckTimeout)
    startupUpdateGateTimer = null
    startupUpdateCheckTimeout = null
    if (!mainWindow) void createMainWindow()
  })
  splash.on('closed', () => {
    if (updateSplashWindow === splash) updateSplashWindow = null
  })

  await splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updateSplashHtml)}`)
}

const finishStartupUpdateGate = async () => {
  if (!startupUpdateGateActive) return
  startupUpdateGateActive = false
  if (startupUpdateGateTimer) clearTimeout(startupUpdateGateTimer)
  if (startupUpdateCheckTimeout) clearTimeout(startupUpdateCheckTimeout)
  startupUpdateGateTimer = null
  startupUpdateCheckTimeout = null

  const splash = updateSplashWindow
  updateSplashWindow = null
  if (splash && !splash.isDestroyed()) splash.close()
  await createMainWindow()
}

const scheduleStartupGateFinish = (minimumVisibleMs = 700) => {
  if (!startupUpdateGateActive) return
  if (startupUpdateGateTimer) clearTimeout(startupUpdateGateTimer)
  const remainingMs = Math.max(0, minimumVisibleMs - (Date.now() - startupUpdateGateStartedAt))
  startupUpdateGateTimer = setTimeout(() => {
    startupUpdateGateTimer = null
    void finishStartupUpdateGate()
  }, remainingMs)
}

const startStartupUpdateFlow = async () => {
  if (!autoUpdateSupported()) {
    await createMainWindow()
    return
  }

  startupUpdateGateActive = true
  startupUpdateGateStartedAt = Date.now()
  try {
    await createUpdateSplashWindow()
  } catch (error) {
    console.error('Ford Kall update splash failed to open', error)
    startupUpdateGateActive = false
    const splash = updateSplashWindow
    updateSplashWindow = null
    if (splash && !splash.isDestroyed()) splash.destroy()
    await createMainWindow()
    return
  }

  startupUpdateCheckTimeout = setTimeout(() => {
    startupUpdateCheckTimeout = null
    if (!startupUpdateGateActive || updateState.status !== 'checking') return
    setUpdateState({
      status: 'error',
      message: 'A verificação demorou mais que o esperado. Abrindo a versão instalada.',
    })
    scheduleStartupGateFinish(1000)
  }, 15000)
  const state = await checkForUpdates()
  if (state.status === 'upToDate') scheduleStartupGateFinish(700)
  if (state.status === 'error') scheduleStartupGateFinish(1000)
}

const startUpdateInstall = ({ allowDuringCall = false } = {}) => {
  if (!autoUpdateSupported() || updateState.status !== 'ready' || updateInstallStarted) return
  if (isInCall && !allowDuringCall) {
    setUpdateState({
      status: 'ready',
      availableVersion: updateState.availableVersion,
      percent: 100,
      message: 'Atualização baixada. Ela será instalada automaticamente quando você sair da call.',
    })
    return
  }

  updateInstallStarted = true
  setUpdateState({
    status: 'installing',
    availableVersion: updateState.availableVersion,
    percent: 100,
    message: 'Reiniciando o Ford Kall para concluir a atualização…',
  })

  // Give the renderer time to show the restart status before the installer closes the app.
  updateInstallTimer = setTimeout(() => {
    updateInstallTimer = null
    isQuitting = true
    globalShortcut.unregisterAll()
    autoUpdater.quitAndInstall(true, true)
  }, 700)
  updateInstallTimer.unref?.()
}

const scheduleUpdateInstall = () => {
  if (!autoUpdateSupported() || updateState.status !== 'ready' || updateInstallStarted) return
  if (updateInstallTimer) clearTimeout(updateInstallTimer)

  updateInstallTimer = setTimeout(() => {
    updateInstallTimer = null
    startUpdateInstall()
  }, 1500)
  updateInstallTimer.unref?.()
}

const checkForUpdates = async () => {
  if (!autoUpdateSupported()) return updateState
  if (['checking', 'downloading', 'ready', 'installing'].includes(updateState.status)) return updateState

  setUpdateState({ status: 'checking', message: 'Consultando as releases do Ford Kall…' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    setUpdateState({
      status: 'error',
      message: 'Não foi possível buscar a atualização. Confira sua conexão e tente novamente.',
    })
  }
  return updateState
}

const setUpdateState = (nextState) => {
  updateState = {
    currentVersion: app.getVersion(),
    ...nextState,
  }
  renderUpdateSplashState(updateState)
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('desktop:update-state', updateState)
  }
}

const configureAutoUpdater = () => {
  if (!autoUpdateSupported()) {
    setUpdateState({
      status: 'unsupported',
      message: unsupportedUpdateMessage(),
    })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.disableWebInstaller = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', message: 'Consultando as releases do Ford Kall…' })
  })
  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'downloading',
      availableVersion: info.version,
      percent: 0,
      message: `Baixando Ford Kall ${info.version}…`,
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      availableVersion: updateState.availableVersion,
      percent: Math.max(0, Math.min(100, progress.percent)),
      message: `Baixando atualização · ${Math.round(progress.percent)}%`,
    })
  })
  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'upToDate', message: 'Você já está na versão mais recente.' })
    scheduleStartupGateFinish(700)
  })
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'ready',
      availableVersion: info.version,
      percent: 100,
      message: isInCall
        ? 'Atualização baixada. Ela será instalada automaticamente quando você sair da call.'
        : 'Atualização baixada. O app vai reiniciar automaticamente para aplicá-la.',
    })
    if (!isInCall) scheduleUpdateInstall()
  })
  autoUpdater.on('error', () => {
    updateInstallStarted = false
    if (updateInstallTimer) clearTimeout(updateInstallTimer)
    updateInstallTimer = null
    setUpdateState({
      status: 'error',
      message: 'Não foi possível buscar ou baixar a atualização. Tente novamente em instantes.',
    })
    scheduleStartupGateFinish(1000)
  })
}

const installRendererIpc = () => {
  ipcMain.on('desktop:set-in-call', (event, value) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    const wasInCall = isInCall
    isInCall = value === true
    rebuildTrayMenu()
    syncGameOverlayRuntime()
    syncGlobalShortcuts()
    if (wasInCall && !isInCall && updateState.status === 'ready') scheduleUpdateInstall()
  })

  ipcMain.on('desktop:set-game-overlay-state', (event, value) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    overlayState = sanitizeOverlayState(value)
    syncGameOverlayRuntime()
  })

  ipcMain.on('desktop:set-game-overlay-speakers', (event, value) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    const speakerIds = new Set(
      Array.isArray(value) ? value.slice(0, 8).map((id) => String(id).slice(0, 128)) : [],
    )
    overlayState = {
      ...overlayState,
      participants: overlayState.participants.map((participant) => ({
        ...participant,
        speaking: speakerIds.has(participant.id),
      })),
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('game-overlay:speakers', [...speakerIds])
    }
  })

  ipcMain.on('desktop:set-shortcut-bindings', (event, value) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    shortcutBindings = sanitizeShortcutBindings(value)
    syncGlobalShortcuts()
  })

  ipcMain.on('desktop:set-shortcut-capture-active', (event, value) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    shortcutCaptureActive = value === true
    syncGlobalShortcuts()
  })

  ipcMain.on('desktop:minimize', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    mainWindow.minimize()
  })

  ipcMain.on('desktop:open-microphone-settings', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (process.platform === 'win32') {
      void shell.openExternal('ms-settings:privacy-microphone')
    }
  })

  ipcMain.handle('desktop:get-info', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return null
    return {
      platform: process.platform,
      version: app.getVersion(),
      publicAppUrl: PUBLIC_APP_URL,
    }
  })

  ipcMain.handle('desktop:get-update-state', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return updateState
    return updateState
  })

  ipcMain.handle('desktop:check-for-updates', async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return updateState
    return checkForUpdates()
  })

  ipcMain.on('desktop:install-update', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (!autoUpdateSupported() || updateState.status !== 'ready') return
    startUpdateInstall({ allowDuringCall: true })
  })
}

const rebuildTrayMenu = () => {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: isInCall ? 'Voltar para a call' : 'Abrir Ford Kall',
      click: showMainWindow,
    },
    {
      label: 'Minimizar para jogar',
      enabled: Boolean(mainWindow?.isVisible()),
      click: () => mainWindow?.minimize(),
    },
    { type: 'separator' },
    {
      label: 'Sair do Ford Kall',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
}

const createTray = () => {
  const trayImage = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 })
  tray = new Tray(trayImage)
  tray.setToolTip('Ford Kall')
  tray.on('click', showMainWindow)
  rebuildTrayMenu()
}

const configureWindowNavigation = (window) => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#030403',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }

    if (url.startsWith('fordkall://')) {
      const roomCode = roomCodeFromDeepLink(url)
      if (roomCode) sendRoomCode(roomCode)
      return { action: 'deny' }
    }

    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
  })
}

const createMainWindow = async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Ford Kall',
    icon: iconPath(),
    backgroundColor: '#080a09',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: true,
    },
  })

  configureWindowNavigation(mainWindow)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingRoomCode) sendRoomCode(pendingRoomCode)
  })
  mainWindow.on('close', (event) => {
    if (isQuitting || !isInCall) return
    event.preventDefault()
    mainWindow?.hide()
    if (!trayHintShown && tray && process.platform === 'win32') {
      trayHintShown = true
      tray.displayBalloon({
        title: 'Ford Kall continua na call',
        content: 'A janela foi fechada, mas seu áudio continua ativo. Use o ícone perto do relógio para voltar ou sair.',
        iconType: 'info',
      })
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('show', rebuildTrayMenu)
  mainWindow.on('hide', rebuildTrayMenu)
  mainWindow.on('minimize', rebuildTrayMenu)
  mainWindow.on('restore', rebuildTrayMenu)

  if (isDevelopment) {
    await mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    await mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

const registerDeepLinkProtocol = () => {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('fordkall', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('fordkall')
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
  registerDeepLinkProtocol()
  if (!isDevelopment) installAppProtocol()
  installCapturePicker()
  installRendererIpc()
  installSessionSecurity()
  configureAutoUpdater()
  createTray()

  pendingRoomCode = findRoomCodeInArguments(process.argv)
  await startStartupUpdateFlow()

  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else if (startupUpdateGateActive) showMainWindow()
    else void createMainWindow()
  })
}).catch((error) => {
  console.error('Ford Kall failed to start', error)
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  if (app.isReady()) globalShortcut.unregisterAll()
  if (activePicker) finishPicker(null)
  stopGameWatcher()
  destroyGameOverlay()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin' || isInCall) return
  app.quit()
})
