import { useState } from 'react'
import { version } from '../../../package.json'
import { GameModal } from '../Games/GameTable'
import { Icon } from './Icon'
export const DesktopDownloads = () => {
  const [open, setOpen] = useState(false)
  if (window.fordKallDesktop) return null
  const base = `https://github.com/matheustorresii/fordkall/releases/download/v${version}/`
  return (
    <>
      <button
        className="desktop-download-trigger"
        type="button"
        aria-label="Baixar app"
        title="Baixar app para Windows ou macOS"
        onClick={() => setOpen(true)}
      >
        <Icon name="popout" />
        <span>Baixar app</span>
      </button>
      {open && (
        <GameModal
          title="Ford Kall no desktop"
          detail={`Versão ${version} · Sua conta e suas salas, no app.`}
          onClose={() => setOpen(false)}
        >
          <div className="desktop-download-options">
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
