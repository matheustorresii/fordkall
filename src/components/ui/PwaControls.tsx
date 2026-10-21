import { useState } from 'react'
import { applyPwaUpdate, checkPwaUpdate, promptPwaInstall, retryPwaConnection, usePwa } from '../../pwa/store'
import { Icon } from './Icon'

export const PwaUpdateCard = () => {
  const pwa = usePwa()
  if (window.fordKallDesktop) return null
  const available = pwa.update === 'available' || pwa.update === 'blocked'
  return (
    <section className="pwa-update-card" aria-label="Atualizações do aplicativo">
      <div className="pwa-update-card__heading"><Icon name="refresh" /><div><strong>Ford Kall {pwa.version}</strong><small>{pwa.installed ? 'Aplicativo web instalado' : 'Versão web'}</small></div></div>
      <p aria-live="polite">{pwa.update === 'checking' ? 'Procurando uma nova versão…' : pwa.update === 'applying' ? 'Aplicando atualização…' : available ? `Nova versão${pwa.nextVersion ? ` ${pwa.nextVersion}` : ''} pronta.${pwa.inCall ? ' Disponível depois da call.' : ''}` : pwa.message || 'Atualizações são preparadas em segundo plano. Sua call nunca é reiniciada automaticamente.'}</p>
      {pwa.message && available && <small className="pwa-update-message">{pwa.message}</small>}
      <div className="pwa-update-card__actions">
        {available ? <button className="settings-primary-button" disabled={pwa.inCall} onClick={() => void applyPwaUpdate()} type="button">{pwa.inCall ? 'Disponível após a call' : 'Atualizar e reabrir'}</button>
          : <button className="settings-secondary-button" disabled={pwa.worker === 'unsupported' || pwa.worker === 'starting' || !pwa.online || ['checking', 'applying'].includes(pwa.update)} onClick={() => void checkPwaUpdate()} type="button">Verificar atualização</button>}
        <span>{pwa.worker === 'ready' ? 'Abertura offline preparada' : pwa.worker === 'starting' ? 'Preparando abertura offline…' : pwa.worker === 'error' ? 'Modo offline não preparado' : 'Disponível no site publicado'}</span>
      </div>
    </section>
  )
}

export const PwaInstallButton = () => {
  const pwa = usePwa()
  if (!pwa.canInstall || pwa.installed) return null
  return <button className="pwa-install-button" disabled={pwa.installing} onClick={() => void promptPwaInstall()} type="button"><Icon name="download" />{pwa.installing ? 'Instalando…' : 'Instalar neste dispositivo'}</button>
}

export const PwaNotices = () => {
  const pwa = usePwa()
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  if (window.fordKallDesktop) return null
  if (!pwa.online && !pwa.inCall) return (
    <div className="pwa-offline-screen" role="status">
      <img src="/icons/icon-192.png" width="72" height="72" alt="Ford Kall" />
      <h1>Você está sem conexão</h1>
      <p>Calls, mensagens e partidas precisam de internet. Seu login e suas preferências continuam neste dispositivo.</p>
      <button disabled={retrying} onClick={() => { setRetrying(true); void retryPwaConnection().finally(() => setRetrying(false)) }} type="button"><Icon name="refresh" />{retrying ? 'Tentando conectar…' : 'Tentar novamente'}</button>
    </div>
  )
  if (!pwa.online) return <div className="pwa-notice pwa-notice--offline" role="status"><Icon name="warning" /><span>Sem internet. A call tentará reconectar.</span></div>
  if (dismissed || !['available', 'blocked'].includes(pwa.update)) return null
  return (
    <aside className="pwa-notice" aria-label="Atualização disponível">
      <Icon name="refresh" /><div><strong>Uma nova versão está pronta</strong><span>{pwa.inCall ? 'Você pode atualizar depois da call.' : 'Reabra o app para usar a versão mais recente.'}</span></div>
      {!pwa.inCall && <button onClick={() => void applyPwaUpdate()} type="button">Atualizar</button>}
      <button aria-label="Lembrar depois" onClick={() => setDismissed(true)} type="button"><Icon name="x" /></button>
    </aside>
  )
}
