import type { ParticipantMedia } from '../../types'
import type { MindRoomState } from '../../hooks/useRoomMind'
import { Icon } from '../ui/Icon'
import './TheMindStage.css'

interface MindGame {
  state: MindRoomState
  hand: number[]
  error: string
  clearError: () => void
  participantCount: number
  start: () => boolean
  play: (card: number) => boolean
  voteShuriken: () => boolean
  nextLevel: () => boolean
  reset: () => boolean
}

interface TheMindStageProps {
  game: MindGame
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}

const avatarLetters = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

export const TheMindStage = ({ game, participants, onExit, onOpenGameHub }: TheMindStageProps) => {
  const localIdentity = participants.find((participant) => participant.isLocal)?.id ?? ''
  const localPlayer = game.state.players.find((player) => player.identity === localIdentity)
  const hasVoted = game.state.shurikenVotes.includes(localIdentity)
  const lobbyPlayers = participants

  return (
    <section className="mind-stage" aria-label="The Mind">
      <header className="mind-stage__topbar">
        <div className="mind-stage__brand">
          <span className="mind-stage__mark"><b>1</b><i>···</i><b>100</b></span>
          <div><small>JOGOS DA SALA</small><strong>The Mind</strong></div>
        </div>
        <button className="mind-stage__hub-button" onClick={onOpenGameHub} type="button"><Icon name="gamepad" />Trocar jogo</button>
        <div className="mind-stage__topbar-actions">
          {game.state.gameId && <span className="mind-stage__status"><i />{game.state.players.length} em equipe</span>}
          <button aria-label="Voltar para a call" className="icon-button" onClick={onExit} title="Voltar para a call" type="button"><Icon name="x" /></button>
        </div>
      </header>

      {game.error && (
        <div className="mind-stage__error" role="alert">
          <Icon name="warning" /><span>{game.error}</span>
          <button aria-label="Fechar aviso" onClick={game.clearError} type="button"><Icon name="x" /></button>
        </div>
      )}

      {game.state.phase === 'lobby' && (
        <div className="mind-lobby">
          <div className="mind-lobby__intro">
            <span className="mind-eyebrow">COOPERATIVO · SILÊNCIO E INTUIÇÃO</span>
            <h2>Uma equipe.<br />Uma sequência.</h2>
            <p>Joguem os números em ordem crescente. Sem combinar, sem falar — só tentem sentir o momento certo.</p>
          </div>
          <div className="mind-lobby__steps">
            <div><i>01</i><span><strong>Guarde</strong> seu número secreto.</span></div>
            <div><i>02</i><span><strong>Espere</strong> sentir que é sua vez.</span></div>
            <div><i>03</i><span><strong>Joguem</strong> juntos do menor ao maior.</span></div>
            <p>Uma carta fora da ordem custa uma vida. Usem o shuriken para revelar a menor carta de cada pessoa.</p>
          </div>
          <div className="mind-lobby__footer">
            <div>
              <small>NA SALA · {game.participantCount} DE 4</small>
              <div className="mind-roster">
                {lobbyPlayers.map((player) => (
                  <span className="mind-roster__person" key={player.id}>
                    <i>{player.avatarDataUrl ? <img alt="" src={player.avatarDataUrl} /> : avatarLetters(player.name)}</i>
                    <span>{player.name}{player.isLocal ? ' · você' : ''}</span>
                  </span>
                ))}
              </div>
            </div>
            <button className="mind-button mind-button--primary" disabled={game.participantCount < 2 || game.participantCount > 4} onClick={game.start} type="button"><Icon name="play" />Começar partida</button>
          </div>
          {game.participantCount < 2 && <small className="mind-lobby__hint">Chamem pelo menos mais uma pessoa para começar.</small>}
          {game.participantCount > 4 && <small className="mind-lobby__hint">The Mind aceita de 2 a 4 pessoas.</small>}
        </div>
      )}

      {game.state.phase !== 'lobby' && (
        <div className="mind-table">
          <div className="mind-table__heading">
            <div>
              <span className="mind-eyebrow">{game.state.phase === 'playing' ? `NÍVEL ${game.state.level} DE ${game.state.maxLevel}` : game.state.phase === 'level-result' ? 'NÍVEL CONCLUÍDO' : game.state.phase === 'won' ? 'PARTIDA PERFEITA' : 'FIM DE JOGO'}</span>
              <h2>{game.state.phase === 'playing' ? 'O menor número começa.' : game.state.phase === 'level-result' ? 'Todos chegaram ao fim.' : game.state.phase === 'won' ? 'Vocês venceram juntos.' : 'As vidas acabaram.'}</h2>
              <p>{game.state.phase === 'playing' ? 'Não contem seus números. Quando sentir, jogue a carta.' : game.state.phase === 'level-result' ? 'Recuperem o fôlego. O próximo nível traz mais cartas.' : game.state.phase === 'won' ? 'Vocês completaram todos os níveis.' : 'Tentem outra vez e confiem mais no ritmo do grupo.'}</p>
            </div>
            <div className="mind-resources" aria-label={`${game.state.lives} vidas e ${game.state.shurikens} shurikens`}>
              <span><small>VIDAS</small><strong>{Array.from({ length: game.state.maxLives }, (_, index) => <i className={index < game.state.lives ? 'is-full' : ''} key={index}>●</i>)}</strong></span>
              <span><small>SHURIKEN</small><strong>{Array.from({ length: game.state.shurikens }, (_, index) => <i className="mind-shuriken" key={index}>✦</i>)}{game.state.shurikens === 0 && <em>0</em>}</strong></span>
            </div>
          </div>

          <div className="mind-table__players">
            {game.state.players.map((player) => {
              const participant = participants.find((person) => person.id === player.identity)
              const voted = game.state.shurikenVotes.includes(player.identity)
              return (
                <div className={`mind-player ${player.identity === localIdentity ? 'is-local' : ''}`} key={player.identity}>
                  <i className="mind-player__avatar">{participant?.avatarDataUrl ? <img alt="" src={participant.avatarDataUrl} /> : avatarLetters(player.name)}</i>
                  <span><strong>{player.name}{player.identity === localIdentity ? ' · você' : ''}</strong><small>{player.cardsRemaining} {player.cardsRemaining === 1 ? 'carta' : 'cartas'} restantes</small></span>
                  {voted && <em>SHURIKEN ✓</em>}
                </div>
              )
            })}
          </div>

          <div className="mind-sequence" aria-label="Cartas jogadas nesta rodada">
            <div className="mind-sequence__heading"><strong>Sequência</strong><small>{game.state.played.length} jogadas</small></div>
            <div className="mind-sequence__cards">
              {game.state.played.length
                ? game.state.played.map((card, index) => <span key={`${card}-${index}`}>{String(card).padStart(2, '0')}</span>)
                : <small>As cartas jogadas aparecem aqui.</small>}
            </div>
          </div>

          {game.state.lastMistake && (
            <div className="mind-mistake" role="status">
              <strong>Uma carta menor ainda estava na mão:</strong>
              <span>{game.state.lastMistake.playedCard} foi jogada antes de {game.state.lastMistake.lowerCards.map((card) => card.value).join(', ')}. Vocês perderam uma vida.</span>
            </div>
          )}
          {!game.state.lastMistake && game.state.lastEvent && <p className="mind-table__event">{game.state.lastEvent}</p>}

          {game.state.phase === 'playing' && (
            <div className="mind-hand">
              <div className="mind-hand__heading">
                <div><strong>Sua mão</strong><small>{localPlayer ? `${game.hand.length} cartas privadas` : 'Você está acompanhando esta partida'}</small></div>
                {game.state.shurikens > 0 && localPlayer && <button className="mind-button mind-button--shuriken" disabled={hasVoted} onClick={game.voteShuriken} type="button">✦ {hasVoted ? `Votou · ${game.state.shurikenVotes.length}/${game.state.players.length}` : `Votar para usar shuriken · ${game.state.shurikenVotes.length}/${game.state.players.length}`}</button>}
              </div>
              {localPlayer ? (
                <div className="mind-hand__cards">
                  {game.hand.map((card) => (
                    <button className="mind-card" key={card} onClick={() => game.play(card)} title={`Jogar ${card}`} type="button">{String(card).padStart(2, '0')}</button>
                  ))}
                  {!game.hand.length && <span className="mind-hand__waiting">Aguardando a equipe…</span>}
                </div>
              ) : <p className="mind-hand__waiting">Só você vê suas cartas. Continue em silêncio e acompanhe a equipe.</p>}
            </div>
          )}

          {game.state.phase === 'level-result' && <div className="mind-result-actions"><button className="mind-button mind-button--primary" onClick={game.nextLevel} type="button"><Icon name="play" />Começar nível {game.state.level + 1}</button><button className="mind-button mind-button--subtle" onClick={game.reset} type="button">Encerrar partida</button></div>}
          {(game.state.phase === 'won' || game.state.phase === 'lost') && <div className="mind-result-actions"><button className="mind-button mind-button--primary" onClick={game.start} type="button"><Icon name="refresh" />Jogar de novo</button><button className="mind-button mind-button--subtle" onClick={onOpenGameHub} type="button">Escolher outro jogo</button></div>}
        </div>
      )}
    </section>
  )
}
