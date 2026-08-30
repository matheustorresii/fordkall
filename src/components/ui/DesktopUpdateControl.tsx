import { useAppUpdater } from '../../hooks/useAppUpdater'
import { Icon } from './Icon'

const labelFor = (status: ReturnType<typeof useAppUpdater>['state']) => {
  if (status.status === 'checking') return 'Verificando…'
  if (status.status === 'downloading') return `Baixando ${Math.round(status.percent || 0)}%`
  if (status.status === 'ready') return `Instalar ${status.availableVersion || 'update'}`
  if (status.status === 'upToDate') return 'Aplicativo atualizado'
  if (status.status === 'error') return 'Tentar novamente'
  if (status.status === 'unsupported') return 'Atualização indisponível'
  return 'Buscar atualização'
}

export const DesktopUpdateControl = ({ variant }: { variant: 'auth' | 'lobby' }) => {
  const updater = useAppUpdater()
  if (!window.fordKallDesktop) return null

  const busy = updater.state.status === 'checking' || updater.state.status === 'downloading'
  const unsupported = updater.state.status === 'unsupported'
  const ready = updater.state.status === 'ready'

  return (
    <button
      aria-live="polite"
      className={`desktop-update-control desktop-update-control--${variant} is-${updater.state.status}`}
      disabled={busy || unsupported}
      onClick={ready ? updater.install : updater.check}
      title={updater.state.message}
      type="button"
    >
      <Icon name="refresh" />
      <span>{labelFor(updater.state)}</span>
      {variant === 'auth' && updater.state.currentVersion && <small>v{updater.state.currentVersion}</small>}
    </button>
  )
}
