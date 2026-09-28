import { useEffect, useState } from 'react'
import type { useAppUpdater } from '../../hooks/useAppUpdater'
import type { useAudioDevices } from '../../hooks/useAudioDevices'
import type { useCallShortcuts } from '../../hooks/useCallShortcuts'
import type { useMicrophoneMonitor } from '../../hooks/useMicrophoneMonitor'
import type { useMicrophoneProcessing } from '../../hooks/useMicrophoneProcessing'
import { formatShortcutBinding, shortcutFromKeyboardEvent } from '../../services/shortcuts'
import { streamQualityPresets } from '../../services/livekit'
import type { ShortcutAction, StreamQualityId } from '../../types'
import { Icon, type IconName } from '../ui/Icon'

type AppUpdaterState = ReturnType<typeof useAppUpdater>
type AudioDevicesState = ReturnType<typeof useAudioDevices>
type CallShortcutsState = ReturnType<typeof useCallShortcuts>
type MicrophoneMonitorState = ReturnType<typeof useMicrophoneMonitor>
type MicrophoneProcessingState = ReturnType<typeof useMicrophoneProcessing>
type SettingsPage = 'audio' | 'video' | 'shortcuts' | 'app'

interface SettingsModalProps {
  devices: AudioDevicesState
  gameOverlayEnabled: boolean
  microphoneMonitor: MicrophoneMonitorState
  microphoneProcessing: MicrophoneProcessingState
  callSoundsEnabled: boolean
  quality: StreamQualityId
  shortcuts: CallShortcutsState
  updater: AppUpdaterState
  onCallSoundsChange: (enabled: boolean) => void
  onGameOverlayChange: (enabled: boolean) => void
  onQualityChange: (quality: StreamQualityId) => void
  onClose: () => void
}

const pages: Array<{ id: SettingsPage; icon: IconName; label: string }> = [
  { id: 'audio', icon: 'headphones', label: 'Voz e áudio' },
  { id: 'video', icon: 'camera', label: 'Vídeo e transmissão' },
  { id: 'shortcuts', icon: 'keyboard', label: 'Atalhos' },
  { id: 'app', icon: 'settings', label: 'Aplicativo' },
]

const shortcutRows: Array<{
  id: ShortcutAction
  icon: IconName
  title: string
  description: string
}> = [
  { id: 'microphone', icon: 'mic', title: 'Mutar microfone', description: 'Liga ou desliga sua voz.' },
  { id: 'deafen', icon: 'headphones', title: 'Ativar deafen', description: 'Silencia todo o áudio remoto.' },
  { id: 'camera', icon: 'camera', title: 'Ligar câmera', description: 'Liga ou desliga sua câmera.' },
  { id: 'screenShare', icon: 'screen', title: 'Compartilhar tela', description: 'Inicia ou encerra a transmissão.' },
  { id: 'leave', icon: 'leave', title: 'Sair da call', description: 'Encerra sua conexão com a sala.' },
]

const deviceName = (device: MediaDeviceInfo, index: number, fallback: string) =>
  device.label || `${fallback} ${index + 1}`

const SettingsCard = ({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description?: string
  title: string
}) => (
  <section className="settings-card">
    <header className="settings-card__header">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </header>
    {children}
  </section>
)

export const SettingsModal = ({
  devices,
  gameOverlayEnabled,
  microphoneMonitor,
  microphoneProcessing,
  callSoundsEnabled,
  quality,
  shortcuts,
  updater,
  onCallSoundsChange,
  onGameOverlayChange,
  onQualityChange,
  onClose,
}: SettingsModalProps) => {
  const [page, setPage] = useState<SettingsPage>('audio')
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)
  const currentPage = pages.find((candidate) => candidate.id === page) ?? pages[0]

  useEffect(() => {
    if (!capturing) return

    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const hasModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
      if (event.key === 'Escape' && !hasModifier) {
        setCapturing(null)
        return
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && !hasModifier) {
        shortcuts.setBinding(capturing, '')
        setCapturing(null)
        return
      }

      const binding = shortcutFromKeyboardEvent(event)
      if (!binding) return
      shortcuts.setBinding(capturing, binding)
      setCapturing(null)
    }

    window.addEventListener('keydown', captureShortcut, true)
    return () => {
      window.removeEventListener('keydown', captureShortcut, true)
    }
  }, [capturing, shortcuts.setBinding])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !capturing) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [capturing, onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-modal settings-hub"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="settings-modal__header settings-hub__header">
          <div>
            <p className="eyebrow">CENTRAL</p>
            <h2 id="settings-title">Configurações</h2>
          </div>
          <button aria-label="Fechar configurações" className="icon-button" onClick={onClose} type="button">
            <Icon name="x" />
          </button>
        </header>

        <div className="settings-hub__body">
          <nav aria-label="Seções das configurações" className="settings-nav">
            <p>Preferências</p>
            {pages.map((candidate) => (
              <button
                aria-current={candidate.id === page ? 'page' : undefined}
                className={candidate.id === page ? 'is-active' : ''}
                key={candidate.id}
                onClick={() => setPage(candidate.id)}
                type="button"
              >
                <Icon name={candidate.icon} />
                <span>{candidate.label}</span>
              </button>
            ))}
            <small>
              {window.fordKallDesktop
                ? `Ford Kall ${updater.state.currentVersion || ''}`
                : 'Ford Kall Web'}
            </small>
          </nav>

          <div className="settings-content">
            <header className="settings-page__heading">
              <span><Icon name={currentPage.icon} /></span>
              <div>
                <h2>{currentPage.label}</h2>
                <p>Suas escolhas ficam salvas somente neste dispositivo.</p>
              </div>
            </header>

            {page === 'audio' && (
              <div className="settings-page">
                <SettingsCard description="Escolha como sua voz é capturada e testada." title="Microfone">
                  <label className="select-field">
                    <span>Entrada de voz</span>
                    <select
                      disabled={devices.loading || devices.inputs.length === 0}
                      onChange={(event) => void devices.switchInput(event.target.value)}
                      value={devices.selectedInput}
                    >
                      {!devices.selectedInput && <option value="">Padrão do sistema</option>}
                      {devices.inputs.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {deviceName(device, index, 'Microfone')}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={`setting-switch ${!microphoneProcessing.supported ? 'is-disabled' : ''}`}>
                    <span>
                      <strong>Supressão de ruído</strong>
                      <small>Reduz teclado, ventoinha e ruído contínuo no próprio dispositivo.</small>
                    </span>
                    <input
                      checked={microphoneProcessing.noiseSuppression}
                      disabled={!microphoneProcessing.supported || microphoneProcessing.busy}
                      onChange={(event) => void microphoneProcessing.setEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    <i aria-hidden="true" />
                  </label>
                  {!microphoneProcessing.supported && (
                    <div className="settings-note"><Icon name="warning" />Seu navegador não expõe esse filtro.</div>
                  )}

                  <label className={`setting-switch ${!microphoneMonitor.supported ? 'is-disabled' : ''}`}>
                    <span>
                      <strong>Ouvir meu microfone</strong>
                      <small>Retorno local para testar como os outros recebem sua voz.</small>
                    </span>
                    <input
                      checked={microphoneMonitor.enabled}
                      disabled={!microphoneMonitor.supported}
                      onChange={(event) => microphoneMonitor.setEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    <i aria-hidden="true" />
                  </label>

                  {microphoneMonitor.enabled && (
                    <div className="monitor-control">
                      <label htmlFor="microphone-monitor-volume">
                        <span>Volume do retorno</span>
                        <output>{Math.round(microphoneMonitor.volume * 100)}%</output>
                      </label>
                      <input
                        id="microphone-monitor-volume"
                        max="2"
                        min="0"
                        onChange={(event) => microphoneMonitor.setVolume(Number(event.target.value))}
                        step="0.05"
                        type="range"
                        value={microphoneMonitor.volume}
                      />
                      <small>Use fones para evitar microfonia. Esse retorno não passa pelo LiveKit.</small>
                    </div>
                  )}
                </SettingsCard>

                <SettingsCard description="Voz e transmissão podem usar saídas diferentes." title="Dispositivos de saída">
                  {devices.outputSelectionSupported ? (
                    <div className="settings-grid">
                      <label className="select-field">
                        <span>Voz da call</span>
                        <select onChange={(event) => devices.setVoiceOutput(event.target.value)} value={devices.preferences.voiceOutputId}>
                          <option value="">Padrão do sistema</option>
                          {devices.outputs.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{deviceName(device, index, 'Saída')}</option>
                          ))}
                        </select>
                      </label>
                      <label className="select-field">
                        <span>Áudio da transmissão</span>
                        <select onChange={(event) => devices.setScreenOutput(event.target.value)} value={devices.preferences.screenOutputId}>
                          <option value="">Padrão do sistema</option>
                          {devices.outputs.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{deviceName(device, index, 'Saída')}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="settings-note"><Icon name="warning" />Será usada a saída padrão do sistema.</div>
                  )}
                </SettingsCard>
              </div>
            )}

            {page === 'video' && (
              <div className="settings-page">
                <SettingsCard description="Escolha a webcam usada quando você ligar a câmera." title="Câmera">
                  <label className="select-field">
                    <span>Entrada de vídeo</span>
                    <select
                      disabled={devices.loading || devices.videoInputs.length === 0}
                      onChange={(event) => void devices.switchVideoInput(event.target.value)}
                      value={devices.selectedVideoInput}
                    >
                      {!devices.selectedVideoInput && <option value="">Padrão do sistema</option>}
                      {devices.videoInputs.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {deviceName(device, index, 'Câmera')}
                        </option>
                      ))}
                    </select>
                  </label>
                  {devices.videoInputs.length === 0 && !devices.loading && (
                    <div className="settings-note"><Icon name="warning" />Nenhuma câmera foi encontrada neste dispositivo.</div>
                  )}
                </SettingsCard>

                <SettingsCard description="A opção escolhida vale para a próxima transmissão." title="Qualidade da tela">
                  <div className="quality-options">
                    {(Object.keys(streamQualityPresets) as StreamQualityId[]).map((qualityId) => (
                      <button
                        className={quality === qualityId ? 'is-active' : ''}
                        key={qualityId}
                        onClick={() => onQualityChange(qualityId)}
                        type="button"
                      >
                        <span>{streamQualityPresets[qualityId].shortLabel}</span>
                        {streamQualityPresets[qualityId].label}
                        <small>{streamQualityPresets[qualityId].usageLabel}</small>
                      </button>
                    ))}
                  </div>
                  <div className="settings-note settings-note--quality">
                    <Icon name="warning" />
                    Resolução, FPS e espectadores aumentam o consumo do LiveKit. 720p30 preserva melhor a franquia gratuita.
                  </div>
                </SettingsCard>
              </div>
            )}

            {page === 'shortcuts' && (
              <div className="settings-page">
                <SettingsCard
                  description={window.fordKallDesktop
                    ? 'Funcionam globalmente, inclusive com o jogo em foco.'
                    : 'No navegador funcionam enquanto a página estiver em foco.'}
                  title="Controles rápidos"
                >
                  <div className="shortcut-intro">
                    <Icon name="keyboard" />
                    <p>Nenhum atalho vem definido. Use qualquer tecla ou uma combinação com Ctrl, Alt, Shift ou Win.</p>
                  </div>
                  <div className="shortcut-list">
                    {shortcutRows.map((row) => {
                      const binding = shortcuts.bindings[row.id]
                      const failed = shortcuts.failedActions.includes(row.id)
                      return (
                        <div className={`shortcut-row ${failed ? 'has-error' : ''}`} key={row.id}>
                          <span className="shortcut-row__icon"><Icon name={row.icon} /></span>
                          <span className="shortcut-row__label">
                            <strong>{row.title}</strong>
                            <small>{failed ? 'Essa tecla já está ocupada por outro aplicativo.' : row.description}</small>
                          </span>
                          <button
                            className={`shortcut-bind ${capturing === row.id ? 'is-capturing' : ''}`}
                            onClick={() => setCapturing(row.id)}
                            type="button"
                          >
                            {capturing === row.id
                              ? 'Pressione uma tecla…'
                              : binding
                                ? formatShortcutBinding(binding)
                                : 'Adicionar atalho'}
                          </button>
                          {binding && (
                            <button
                              aria-label={`Remover atalho de ${row.title}`}
                              className="shortcut-clear"
                              onClick={() => shortcuts.setBinding(row.id, '')}
                              title="Remover atalho"
                              type="button"
                            >
                              <Icon name="x" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </SettingsCard>
              </div>
            )}

            {page === 'app' && (
              <div className="settings-page">
                <SettingsCard description="Feedback local para presença e controles da call." title="Experiência">
                  <label className="setting-switch">
                    <span>
                      <strong>Efeitos sonoros</strong>
                      <small>Buzina de entrada, saída, microfone e deafen.</small>
                    </span>
                    <input checked={callSoundsEnabled} onChange={(event) => onCallSoundsChange(event.target.checked)} type="checkbox" />
                    <i aria-hidden="true" />
                  </label>

                  {window.fordKallDesktop?.platform === 'win32' && (
                    <>
                      <label className="setting-switch">
                        <span>
                          <strong>Overlay nos jogos</strong>
                          <small>Mostra participantes em jogos fullscreen ou borderless.</small>
                        </span>
                        <input checked={gameOverlayEnabled} onChange={(event) => onGameOverlayChange(event.target.checked)} type="checkbox" />
                        <i aria-hidden="true" />
                      </label>
                      <div className="settings-note"><Icon name="warning" />Alguns jogos com fullscreen exclusivo ou anti-cheat podem cobrir o overlay.</div>
                    </>
                  )}
                </SettingsCard>

                {window.fordKallDesktop && (
                  <SettingsCard description="O app consulta as releases oficiais do GitHub." title="Atualizações">
                    <div className={`settings-update-card is-${updater.state.status}`}>
                      <span className="settings-update-card__icon"><Icon name="refresh" /></span>
                      <div>
                        <strong>
                          {updater.state.status === 'ready'
                            ? `Versão ${updater.state.availableVersion} pronta`
                            : `Ford Kall ${updater.state.currentVersion}`}
                        </strong>
                        <p>{updater.state.message}</p>
                        {updater.state.status === 'downloading' && (
                          <div className="update-progress" aria-label={`Download ${Math.round(updater.state.percent ?? 0)}%`}>
                            <i style={{ width: `${updater.state.percent ?? 0}%` }} />
                          </div>
                        )}
                      </div>
                      {updater.state.status === 'ready' ? (
                        <button className="settings-primary-button" onClick={updater.install} type="button">Instalar e reiniciar</button>
                      ) : updater.state.status !== 'unsupported' ? (
                        <button
                          className="settings-secondary-button"
                          disabled={updater.state.status === 'checking' || updater.state.status === 'downloading'}
                          onClick={updater.check}
                          type="button"
                        >
                          {updater.state.status === 'checking' ? 'Procurando…' : updater.state.status === 'downloading' ? 'Baixando…' : 'Checar update'}
                        </button>
                      ) : null}
                    </div>
                    {updater.state.status === 'ready' && (
                      <div className="settings-note"><Icon name="warning" />O app será fechado, atualizado e aberto novamente.</div>
                    )}
                  </SettingsCard>
                )}
              </div>
            )}

            {(devices.error || microphoneProcessing.error || microphoneMonitor.error) && (
              <div className="inline-error">{devices.error || microphoneProcessing.error || microphoneMonitor.error}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
