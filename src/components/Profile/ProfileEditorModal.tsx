import { useState } from 'react'
import { normalizeProfile } from '../../services/profile'
import type { LocalProfile } from '../../types'
import { Icon } from '../ui/Icon'
import { ProfileStudio } from './ProfileStudio'

export const ProfileEditorModal = ({
  profile,
  onClose,
  onSave,
}: {
  profile: LocalProfile
  onClose: () => void
  onSave: (profile: LocalProfile) => Promise<void>
}) => {
  const [draft, setDraft] = useState(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    const normalized = normalizeProfile(draft)
    if (!normalized.displayName) {
      setError('Seu perfil precisa de um nome.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(normalized)
      onClose()
    } catch {
      setError('Não foi possível salvar seu perfil agora.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="profile-modal-backdrop" onMouseDown={onClose} role="presentation">
      <section aria-modal="true" className="profile-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header><div><p className="eyebrow">CUSTOM SHOP</p><h2>Seu perfil</h2></div><button aria-label="Fechar perfil" className="icon-button" onClick={onClose}><Icon name="x" /></button></header>
        <div className="profile-modal__body"><ProfileStudio onChange={setDraft} value={draft} /></div>
        <footer>{error && <span><Icon name="warning" />{error}</span>}<button onClick={onClose}>Cancelar</button><button disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar perfil'}</button></footer>
      </section>
    </div>
  )
}
