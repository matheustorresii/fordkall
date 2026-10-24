import { useEffect, useState } from 'react'
import type { Room } from 'livekit-client'
import { recoveryEnabled, roomRecoveryHub } from '../../hooks/useGameRecovery'
import { Icon } from '../ui/Icon'
import './GameRecoveryStatus.css'
export function GameRecoveryStatus({ room }: { room: Room }) {
  const [, render] = useState(0)
  useEffect(() => {
    if (!recoveryEnabled(room)) return
    const timer = window.setInterval(() => render((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [room])
  if (!recoveryEnabled(room)) return null
  const coordinator = roomRecoveryHub(room).coordinator
  const paused = [...coordinator.bindings.entries()].filter(
    ([topic, binding]) =>
      binding.capture().state.gameId && coordinator.paused(topic),
  )
  if (!paused.length) return null
  const missing = [
    ...new Map(
      paused
        .flatMap(([, binding]) =>
          coordinator.missingPlayers(binding.capture().state),
        )
        .map((person) => [person.identity, person]),
    ).values(),
  ]
  return (
    <aside className="game-recovery-status" role="status">
      <Icon name="pause" />
      <div>
        <strong>Partida pausada</strong>
        <span>
          {coordinator.error ||
            (missing.length
              ? `Aguardando ${missing.map((person) => person.name || 'jogador').join(', ')} voltar. Reconecte em até 90 segundos para manter seu lugar.`
              : 'Restaurando a mesa e as cartas privadas…')}
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          void coordinator.refresh().then(() => coordinator.heartbeat())
        }
      >
        Tentar agora
      </button>
    </aside>
  )
}
