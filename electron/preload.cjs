const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fordKallDesktop', {
  isDesktop: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send('desktop:minimize'),
  openMicrophoneSettings: () => ipcRenderer.send('desktop:open-microphone-settings'),
  setInCall: (inCall) => ipcRenderer.send('desktop:set-in-call', inCall === true),
  notifyCall: (name) => ipcRenderer.send('desktop:notify-call', name),
  dismissCallNotification: () => ipcRenderer.send('desktop:dismiss-call-notification'),
  getPerformanceSample: () => ipcRenderer.invoke('desktop:performance-sample'),
  setGameOverlayState: (state) => ipcRenderer.send('desktop:set-game-overlay-state', state),
  setGameOverlaySpeakers: (participantIds) => ipcRenderer.send('desktop:set-game-overlay-speakers', participantIds),
  setShortcutBindings: (bindings) => ipcRenderer.send('desktop:set-shortcut-bindings', bindings),
  setShortcutCaptureActive: (active) => ipcRenderer.send('desktop:set-shortcut-capture-active', active === true),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  installUpdate: () => ipcRenderer.send('desktop:install-update'),
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  onOpenRoom: (listener) => {
    const wrappedListener = (_event, roomCode) => listener(roomCode)
    ipcRenderer.on('desktop:open-room', wrappedListener)
    return () => ipcRenderer.removeListener('desktop:open-room', wrappedListener)
  },
  onShortcut: (listener) => {
    const wrappedListener = (_event, action) => listener(action)
    ipcRenderer.on('desktop:shortcut', wrappedListener)
    return () => ipcRenderer.removeListener('desktop:shortcut', wrappedListener)
  },
  onShortcutStatus: (listener) => {
    const wrappedListener = (_event, status) => listener(status)
    ipcRenderer.on('desktop:shortcut-status', wrappedListener)
    return () => ipcRenderer.removeListener('desktop:shortcut-status', wrappedListener)
  },
  onUpdateState: (listener) => {
    const wrappedListener = (_event, state) => listener(state)
    ipcRenderer.on('desktop:update-state', wrappedListener)
    return () => ipcRenderer.removeListener('desktop:update-state', wrappedListener)
  },
})
