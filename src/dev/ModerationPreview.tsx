import { useState } from 'react'
import type { AppRole, ContextMenuPoint } from '../types'
import { ParticipantGallery } from '../components/Participants/ParticipantGallery'
import { ParticipantContextMenu } from '../components/Participants/ParticipantContextMenu'
import { ParticipantDisconnectDialog } from '../components/Participants/ParticipantDisconnectDialog'
import { BrandMark } from '../components/ui/BrandMark'
import { Icon } from '../components/ui/Icon'
import { DEFAULT_PROFILE_APPEARANCE } from '../services/profile'

const people = ['Você', 'Amigo da call', 'Pessoa com um nome bastante comprido'].map((name, i) => ({
  id: `qa-${i}`,
  name,
  isLocal: i === 0,
  appearance: DEFAULT_PROFILE_APPEARANCE,
  cameraEnabled: false,
  microphoneMuted: i === 2,
}))
export const ModerationPreview = () => {
  const [role, setRole] = useState<AppRole>('owner')
  const [participants, setParticipants] = useState(people)
  const [menu, setMenu] = useState<{ id: string; point: ContextMenuPoint } | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const selected = participants.find((p) => p.id === menu?.id)
  const disconnecting = participants.find((p) => p.id === target)
  return (
    <main className="call-shell">
      <header className="call-header">
        <button className="brand brand--compact call-home-button" type="button">
          <BrandMark />
          <h1>FORD KALL</h1>
        </button>
        <div className="call-header__actions">
          <span>Prévia local · sem pessoas reais</span>
          <label>
            Papel{' '}
            <select
              aria-label="Papel da prévia"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as AppRole)
                setMenu(null)
                setTarget(null)
              }}
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </label>
        </div>
      </header>
      <div className="call-workspace">
        <ParticipantGallery
          participants={participants}
          activeSpeakerIds={new Set()}
          onParticipantMenu={(id, point) => setMenu({ id, point })}
        />
      </div>
      {selected && menu && (
        <ParticipantContextMenu
          participant={selected}
          point={menu.point}
          onClose={() => setMenu(null)}
          onDisconnect={
            role === 'owner' && !selected.isLocal
              ? () => {
                  setTarget(selected.id)
                  setMenu(null)
                }
              : undefined
          }
        />
      )}
      {disconnecting && (
        <ParticipantDisconnectDialog
          name={disconnecting.name}
          connected={true}
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 450))
            if (failed) throw new Error('CALL_MODERATION_UNAVAILABLE')
            setParticipants((all) => all.filter((p) => p.id !== target))
            setNotice(`${disconnecting.name} foi desconectado da call.`)
            setTarget(null)
          }}
        />
      )}
      <div className="call-notices" style={{ pointerEvents: 'auto' }}>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> Simular
          falha do servidor
        </label>
        {notice && <p role="status">{notice}</p>}
        <button
          onClick={() => {
            setParticipants(people)
            setNotice('')
          }}
          type="button"
        >
          Restaurar participantes
        </button>
      </div>
      <footer className="call-dock">
        <div className="call-dock__group">
          {(['micOff', 'cameraOff', 'headphones', 'screen', 'settings', 'leave'] as const).map((name) => (
            <button aria-label={name} className="call-control" key={name} type="button">
              <span className="call-control__icon">
                <Icon name={name} />
              </span>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </footer>
    </main>
  )
}
