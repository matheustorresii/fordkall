import { useState } from 'react'
import { version } from '../../../package.json'
import { GameModal } from '../Games/GameTable'
import { Icon } from './Icon'
import { usePwa } from '../../pwa/store'
import { installInstructions } from '../../pwa/policy'
import { PwaInstallButton, PwaUpdateCard } from './PwaControls'
export const DesktopDownloads = () => {
  const [open, setOpen] = useState(false)
  const pwa = usePwa()
  if (window.fordKallDesktop) return null
  const guide = installInstructions(navigator.userAgent)
  const base = `https://github.com/matheustorresii/fordkall/releases/download/v${version}/`
  if (pwa.installed) return (
    <>
      <button className="desktop-download-trigger" type="button" aria-label="Aplicativo" title="Aplicativo e atualizações" onClick={() => setOpen(true)}>
        <Icon name="settings" /><span>Aplicativo</span>
      </button>
      {open && <GameModal title="Aplicativo" detail="Ford Kall neste dispositivo" onClose={() => setOpen(false)}>
        <PwaUpdateCard />
      </GameModal>}
    </>
  )
  return (
    <>
      <button
        className="desktop-download-trigger"
        type="button"
        aria-label="Baixar app"
        title="Instalar no celular ou baixar para Android, Windows e macOS"
        onClick={() => setOpen(true)}
      >
        <Icon name="download" />
        <span>Baixar app</span>
      </button>
      {open && (
        <GameModal
          title="Ford Kall no seu dispositivo"
          detail="A mesma conta. Suas calls, conversas e jogos."
          onClose={() => setOpen(false)}
        >
          <div className="pwa-downloads">
            <PwaInstallButton />
            <section className="pwa-install-help">
              <h3>{guide.platform === 'ios' ? 'Instalar no iPhone ou iPad' : 'Instalar pelo navegador'}</h3>
              <p>Sem loja de aplicativos. Abre em uma janela própria e recebe as atualizações do site.</p>
              <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </section>
            <PwaUpdateCard />
          </div>
          <div className="pwa-download-divider">Ou baixe um instalador</div>
          <div className="desktop-download-options">
            <a href={`${base}Ford-Kall-${version}-android.apk`}>
              <Icon name="download" />
              <strong>
                Android<small>APK · Android 8 ou superior · Navegador atualizado</small>
              </strong>
              <span>Baixar .apk ↗</span>
            </a>
            <a href={`${base}Ford-Kall-Setup-${version}-x64.exe`}>
              <Icon name="popout" />
              <strong>
                Windows<small>Instalador · Windows 10 ou superior</small>
              </strong>
              <span>Baixar .exe ↗</span>
            </a>
            <a href={`${base}Ford-Kall-${version}-universal.dmg`}>
              <Icon name="popout" />
              <strong>
                macOS<small>Apple Silicon e Intel · Universal</small>
              </strong>
              <span>Baixar .dmg ↗</span>
            </a>
          </div>
          <p className="desktop-download-note">
            Android: o APK abre a PWA com o navegador do sistema. As atualizações
            do conteúdo chegam pelo site. Calls em segundo plano e transmissão da
            tela dependem do suporte do navegador; o APK não remove essas limitações.
          </p>
          <p className="desktop-download-note">
            Windows: atualizações pelo próprio app. macOS: instale a nova versão
            por cima da anterior. Se o macOS pedir confirmação de segurança,
            confira a origem do arquivo antes de abrir.
          </p>
          <a
            href="https://github.com/matheustorresii/fordkall/releases/latest"
            target="_blank"
            rel="noreferrer"
          >
            Notas e todos os downloads ↗
          </a>
        </GameModal>
      )}
    </>
  )
}
