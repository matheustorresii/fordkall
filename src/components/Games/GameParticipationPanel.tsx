import { useState } from 'react'
import type { ParticipantMedia } from '../../types'
import type { RoomGameParticipation } from '../../hooks/useRoomGameParticipation'
import { GAME_LIMITS, type GameKind } from '../../games/gameParticipation'
import { Icon } from '../ui/Icon'
import { GameModal } from './GameTable'
import './GameParticipationPanel.css'

export const GameParticipationPanel = ({ kind, participation, participants, activeIds, active, onClose }: {
  kind: GameKind; participation: Pick<RoomGameParticipation, 'state' | 'setPlaying' | 'remove' | 'error' | 'clearError'>; participants: ParticipantMedia[]; activeIds: string[]; active: boolean; onClose: () => void
}) => {
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const attendance = participation.state.games[kind], local = participants.find((person) => person.isLocal)
  const mine = Boolean(local && !attendance.spectators.includes(local.id))
  const organizer = participants.find((person) => person.id === attendance.organizer)
  const canManage = mine && (!organizer || organizer.id === local?.id)
  const target = participants.find((person) => person.id === confirmation)
  const playing = participants.filter((person) => !attendance.spectators.includes(person.id))
  const watching = participants.filter((person) => attendance.spectators.includes(person.id))
  const leave = (identity: string) => {
    const isActive = active && activeIds.includes(identity)
    if (isActive) setConfirmation(identity)
    else if (identity === local?.id) participation.setPlaying(kind, false)
    else participation.remove(kind, identity)
  }
  const confirm = () => {
    if (!target) return
    const accepted = target.id === local?.id ? participation.setPlaying(kind, false) : participation.remove(kind, target.id)
    if (accepted) setConfirmation(null)
  }
  return <GameModal detail="A call continua igual. Escolha se quer jogar ou apenas acompanhar esta mesa." onClose={onClose} title={`Jogadores · ${GAME_LIMITS[kind].name}`}>
    {participation.error && <p className="game-participation-error" role="alert">{participation.error}<button aria-label="Fechar aviso" onClick={participation.clearError} type="button">×</button></p>}
    {target ? <div className="game-participation-confirm"><h3>{target.isLocal ? 'Ficar só assistindo?' : `Mover ${target.name} para espectador?`}</h3><p>{GAME_LIMITS[kind].leaving}</p><p>Ninguém será desconectado da call.</p><div className="game-modal__actions"><button className="game-action" onClick={() => setConfirmation(null)} type="button">Cancelar</button><button className="game-action game-action--primary" onClick={confirm} type="button">Confirmar</button></div></div> : <>
      <div className="game-participation-choice"><div><strong>{mine ? 'Você participa' : 'Você está só assistindo'}</strong><small>Essa escolha vale só para este jogo.</small></div><button className={`game-action ${mine ? '' : 'game-action--primary'}`} onClick={() => mine && local ? leave(local.id) : participation.setPlaying(kind, true)} type="button"><Icon name={mine ? 'eye' : 'gamepad'} />{mine ? 'Ficar só assistindo' : 'Voltar a participar'}</button></div>
      <div className="game-participation-list"><h3>Na mesa <span>{playing.length}/{GAME_LIMITS[kind].max}</span></h3>{playing.map((person) => <div className="game-participation-person" key={person.id}><span className="game-participation-avatar">{person.avatarDataUrl ? <img alt="" src={person.avatarDataUrl} /> : person.name.slice(0, 1)}</span><div><strong>{person.name}{person.isLocal ? ' (você)' : ''}</strong><small>{organizer?.id === person.id ? 'Organiza a mesa' : active && !activeIds.includes(person.id) ? 'Próxima partida' : 'Participando'}</small></div>{canManage && !person.isLocal && <button aria-label={`Mover ${person.name} para espectador`} className="game-action" onClick={() => leave(person.id)} type="button"><Icon name="eye" /><span>Só assistir</span></button>}</div>)}</div>
      {watching.length > 0 && <div className="game-participation-list"><h3>Assistindo <span>{watching.length}</span></h3>{watching.map((person) => <div className="game-participation-person" key={person.id}><span className="game-participation-avatar">{person.avatarDataUrl ? <img alt="" src={person.avatarDataUrl} /> : person.name.slice(0, 1)}</span><div><strong>{person.name}{person.isLocal ? ' (você)' : ''}</strong><small>Só a própria pessoa pode voltar a participar.</small></div></div>)}</div>}
      <p className="game-participation-note">{organizer ? `${organizer.name} organiza esta mesa.` : 'Quem iniciar ou organizar os participantes passa a cuidar desta mesa.'} Estar na call não impede você de escolher só assistir.</p>
    </>}
  </GameModal>
}
