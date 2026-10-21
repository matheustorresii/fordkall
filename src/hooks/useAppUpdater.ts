import { useCallback, useEffect, useState } from 'react'
import type { AppUpdateState } from '../types'

const webState: AppUpdateState = {
  status: 'unsupported',
  currentVersion: '',
  message: 'Atualizações da versão web são preparadas em segundo plano, sem interromper sua call.',
}

export const useAppUpdater = () => {
  const desktop = window.fordKallDesktop
  const [state, setState] = useState<AppUpdateState>(webState)

  useEffect(() => {
    if (!desktop) return
    let active = true
    void desktop.getUpdateState().then((nextState) => {
      if (active) setState(nextState)
    })
    const stop = desktop.onUpdateState((nextState) => setState(nextState))
    return () => {
      active = false
      stop()
    }
  }, [desktop])

  const check = useCallback(() => {
    if (!desktop) return
    void desktop.checkForUpdates().then(setState)
  }, [desktop])

  const install = useCallback(() => {
    desktop?.installUpdate()
  }, [desktop])

  return { state, check, install, supported: Boolean(desktop) }
}
