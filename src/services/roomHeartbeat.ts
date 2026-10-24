export interface RoomHeartbeatOptions {
  send(leave: boolean): Promise<unknown>
  connected(): boolean
  window: Pick<
    Window,
    'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'
  >
  document: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  >
}

// Imperative connection lifetime, not a React effect: StrictMode cleanup must never
// announce that a live connection left. Each sender is scoped to its token issuance ID.
export function startRoomHeartbeat(options: RoomHeartbeatOptions) {
  let stopped = false
  let inFlight = false
  const refresh = async () => {
    if (stopped || inFlight || !options.connected()) return
    inFlight = true
    try {
      await options.send(false)
    } catch {
      /* Transient errors retry on focus, reconnect or the next heartbeat. */
    } finally {
      inFlight = false
    }
  }
  const visible = () => {
    if (options.document.visibilityState === 'visible') void refresh()
  }
  const resume = () => {
    void refresh()
  }
  const timer = options.window.setInterval(resume, 25000)
  options.window.addEventListener('online', resume)
  options.window.addEventListener('focus', resume)
  options.window.addEventListener('pageshow', resume)
  options.document.addEventListener('visibilitychange', visible)
  void refresh()
  return {
    refresh,
    stop() {
      if (stopped) return
      stopped = true
      options.window.clearInterval(timer)
      options.window.removeEventListener('online', resume)
      options.window.removeEventListener('focus', resume)
      options.window.removeEventListener('pageshow', resume)
      options.document.removeEventListener('visibilitychange', visible)
      void options.send(true).catch(() => undefined)
    },
  }
}
