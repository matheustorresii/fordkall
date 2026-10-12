import { useEffect, useState, type FormEvent } from 'react'
import type { ParticipantMedia } from '../../types'
import type { ItoPlayer, ItoRoomState } from '../../hooks/useRoomIto'
import { Icon } from '../ui/Icon'
import './ItoGameStage.css'

interface ItoGameController {
  state: ItoRoomState
  localNumber: number | null
  error: string
  clearError: () => void
  isController: boolean
  participantCount: number
  isParticipating: boolean
  start: () => boolean
  submitClue: (clue: string) => boolean
  movePlayer: (identity: string, offset: -1 | 1) => boolean
  reveal: () => boolean
  reset: () => boolean
}

interface ItoGameStageProps {
  game: ItoGameController
  participants: ParticipantMedia[]
  onExit: () => void
  onSelectKiwi: () => void
}

const avatarLetters = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

const numberFor = (identity: string, state: ItoRoomState) => state.numbers?.[identity]

const playerById = (players: ItoPlayer[], identity: string) =>
  players.find((player) => player.identity === identity)

const ItoRoster = ({
  players,
  participants,
}: {
  players: ParticipantMedia[]
  participants: ParticipantMedia[]
}) => (
  <div className="ito-roster" aria-label="Pessoas na sala">
    {players.map((player) => (
      <div className="ito-roster__person" key={player.id} title={player.name}>
        <span className="ito-roster__avatar">
          {player.avatarDataUrl ? <img alt="" src={player.avatarDataUrl} /> : avatarLetters(player.name)}
        </span>
        <span>{player.name}</span>
        {player.microphoneMuted && <Icon name="micOff" />}
      </div>
    ))}
    {players.length === 0 && participants.map((participant) => (
      <div className="ito-roster__person" key={participant.id} title={participant.name}>
        <span className="ito-roster__avatar">
          {participant.avatarDataUrl
            ? <img alt="" src={participant.avatarDataUrl} />
            : avatarLetters(participant.name)}
        </span>
        <span>{participant.name}</span>
        {participant.microphoneMuted && <Icon name="micOff" />}
      </div>
    ))}
  </div>
)

export const ItoGameStage = ({ game, participants, onExit, onSelectKiwi }: ItoGameStageProps) => {
  const [draft, setDraft] = useState('')
  const myIdentity = participants.find((participant) => participant.isLocal)?.id ?? ''
  const myPlayer = playerById(game.state.players, myIdentity)
  const allCluesSubmitted = game.state.players.length > 0 && game.state.players.every((player) => player.clue)
  const orderedPlayers = game.state.order
    .map((identity) => playerById(game.state.players, identity))
    .filter((player): player is ItoPlayer => Boolean(player))

  useEffect(() => setDraft(''), [game.state.gameId, game.state.phase])

  const submitClue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (game.submitClue(draft)) setDraft('')
  }

  return (
    <section className="ito-stage" aria-label="Jogo ITO">
      <div className="ito-stage__topbar">
        <div className="ito-stage__brand">
          <span className="ito-stage__mark"><Icon name="gamepad" /></span>
          <div>
            <small>JOGOS DA SALA</small>
            <strong>ITO <span>· cooperativo</span></strong>
          </div>
        </div>
        <nav className="ito-stage__switcher" aria-label="Escolher jogo">
          <button className="is-active" type="button">ITO</button>
          <button onClick={onSelectKiwi} type="button">Exploding Kiwi</button>
        </nav>
        <div className="ito-stage__topbar-actions">
          {game.state.gameId && <span className="ito-stage__status"><i />{game.state.players.length} na rodada</span>}
          <button aria-label="Voltar para a call" className="icon-button" onClick={onExit} title="Voltar para a call" type="button">
            <Icon name="x" />
          </button>
        </div>
      </div>

      {game.error && (
        <div className="ito-stage__error" role="alert">
          <Icon name="warning" />
          <span>{game.error}</span>
          <button aria-label="Fechar aviso" onClick={game.clearError} type="button"><Icon name="x" /></button>
        </div>
      )}

      {game.state.phase === 'lobby' && (
        <div className="ito-lobby">
          <div className="ito-lobby__intro">
            <span className="ito-eyebrow">UM JOGO DE INTUIÇÃO EM GRUPO</span>
            <h2>Cada um tem uma peça.<br />A ordem é de todo mundo.</h2>
            <p>
              Cada pessoa recebe um número secreto. Dê uma dica sem falar o número e,
              juntos, organizem as respostas do menor para o maior.
            </p>
          </div>

          <div className="ito-lobby__steps">
            <div><span>01</span><p><strong>Receba</strong> um número secreto de 1 a 100.</p></div>
            <div><span>02</span><p><strong>Dê uma dica</strong> usando o tema da rodada.</p></div>
            <div><span>03</span><p><strong>Ordenem</strong> as dicas e revelem os números.</p></div>
          </div>

          <div className="ito-lobby__footer">
            <div>
              <small>NA SALA AGORA · {game.participantCount}</small>
              <ItoRoster participants={participants} players={[]} />
            </div>
            <button
              className="ito-button ito-button--primary"
              disabled={game.participantCount < 2 || game.participantCount > 8}
              onClick={() => game.start()}
              type="button"
            >
              <Icon name="play" /> Começar partida
            </button>
          </div>
          {game.participantCount < 2 && <small className="ito-lobby__hint">Chame pelo menos mais uma pessoa para começar.</small>}
          {game.participantCount > 8 && <small className="ito-lobby__hint">A primeira versão aceita até 8 pessoas em uma rodada.</small>}
        </div>
      )}

      {game.state.phase !== 'lobby' && (
        <div className={`ito-round ito-round--${game.state.phase}`}>
          <div className="ito-round__heading">
            <div>
              <span className="ito-eyebrow">
                {game.state.phase === 'clue' ? 'RODADA · 01' : game.state.phase === 'order' ? 'TODO MUNDO DEU UMA DICA' : 'RESULTADO'}
              </span>
              <h2>{game.state.phase === 'revealed'
                ? game.state.succeeded ? 'Ordem perfeita.' : 'Quase lá.'
                : game.state.phase === 'order' ? 'Como vocês colocariam em ordem?'
                  : 'Qual é a sua dica?'}</h2>
              <p className="ito-round__topic">{game.state.topic}</p>
            </div>
            {game.state.phase === 'revealed' && (
              <span className={`ito-result ${game.state.succeeded ? 'ito-result--success' : 'ito-result--retry'}`}>
                {game.state.succeeded ? 'Todos juntos' : 'Tentem de novo'}
              </span>
            )}
          </div>

          {game.state.phase === 'clue' && (
            <div className="ito-secret-row">
              <div className="ito-number-card">
                <small>SEU NÚMERO SECRETO</small>
                {game.isParticipating && game.localNumber !== null
                  ? <strong>{game.localNumber}</strong>
                  : <strong className="ito-number-card__waiting">···</strong>}
                <span>{game.isParticipating
                  ? game.localNumber !== null ? 'Guarde só para você.' : 'Recebendo sua carta…'
                  : 'Você está assistindo esta rodada.'}</span>
              </div>
              {game.isParticipating && (
                <form className="ito-clue-form" onSubmit={submitClue}>
                  {myPlayer?.clue ? (
                    <div className="ito-submitted-note">
                      <span className="ito-check">✓</span>
                      <div><small>SUA DICA FOI ENVIADA</small><strong>{myPlayer.clue}</strong></div>
                    </div>
                  ) : (
                    <>
                      <label htmlFor="ito-clue">Que dica ajuda a colocar seu número no lugar certo?</label>
                      <div className="ito-clue-form__input">
                        <input
                          autoComplete="off"
                          id="ito-clue"
                          maxLength={80}
                          disabled={game.localNumber === null}
                          onChange={(event) => setDraft(event.currentTarget.value)}
                          placeholder="Uma dica curta, sem revelar o número"
                          value={draft}
                        />
                        <button aria-label="Enviar dica" disabled={!draft.trim() || game.localNumber === null} type="submit"><Icon name="send" /></button>
                      </div>
                      <small>Não diga seu número nem uma pista matemática direta.</small>
                    </>
                  )}
                </form>
              )}
            </div>
          )}

          {game.state.phase === 'clue' && (
            <div className="ito-player-grid">
              {game.state.players.map((player) => (
                <div className={`ito-player-card ${player.clue ? 'is-ready' : ''}`} key={player.identity}>
                  <span className="ito-player-card__avatar">
                    {participants.find((participant) => participant.id === player.identity)?.avatarDataUrl
                      ? <img alt="" src={participants.find((participant) => participant.id === player.identity)?.avatarDataUrl} />
                      : avatarLetters(player.name)}
                  </span>
                  <span className="ito-player-card__copy">
                    <strong>{player.name}{player.identity === myIdentity ? ' · você' : ''}</strong>
                    <small>{player.clue || 'Pensando na dica…'}</small>
                  </span>
                  <span className="ito-player-card__status" aria-label={player.clue ? 'Dica enviada' : 'Aguardando dica'}>
                    {player.clue ? '✓' : <span />}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(game.state.phase === 'order' || game.state.phase === 'revealed') && (
            <div className="ito-order-list" aria-label="Ordem das dicas">
              {orderedPlayers.map((player, index) => (
                <div className="ito-order-row" key={player.identity}>
                  <span className="ito-order-row__position">{String(index + 1).padStart(2, '0')}</span>
                  <div className="ito-order-row__person">
                    <span className="ito-player-card__avatar">{avatarLetters(player.name)}</span>
                    <span><strong>{player.name}</strong><small>{player.clue}</small></span>
                  </div>
                  {game.state.phase === 'revealed' ? (
                    <strong className="ito-order-row__number">{numberFor(player.identity, game.state) ?? '—'}</strong>
                  ) : (
                    <div className="ito-order-row__controls">
                      <button aria-label={`Mover ${player.name} para cima`} disabled={!game.isParticipating || index === 0} onClick={() => game.movePlayer(player.identity, -1)} type="button">↑</button>
                      <button aria-label={`Mover ${player.name} para baixo`} disabled={!game.isParticipating || index === orderedPlayers.length - 1} onClick={() => game.movePlayer(player.identity, 1)} type="button">↓</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="ito-round__footer">
            <span>{game.state.phase === 'clue'
              ? `${game.state.players.filter((player) => player.clue).length} de ${game.state.players.length} dicas enviadas`
              : game.state.phase === 'order' ? 'Ajuste a ordem em conjunto antes de revelar.'
                : game.state.succeeded ? 'Vocês descobriram a ordem sem errar.' : 'A ordem não ficou crescente desta vez.'}</span>
            {game.state.phase === 'order' && (
              <button className="ito-button ito-button--primary" disabled={!game.isParticipating || !allCluesSubmitted} onClick={() => game.reveal()} type="button">
                Revelar números <Icon name="chevron" />
              </button>
            )}
            {game.state.phase === 'revealed' && (
              <button className="ito-button ito-button--primary" onClick={() => game.reset()} type="button">
                <Icon name="refresh" /> Nova partida
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
