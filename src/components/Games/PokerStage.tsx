import { useEffect, useState, type ComponentProps, type CSSProperties } from 'react'
import type { ParticipantMedia } from '../../types'
import type { useRoomPoker } from '../../hooks/useRoomPoker'
import {
  defaultPokerSettings,
  evaluatePokerHand,
  pokerLegalActions,
  pokerPotTotal,
  readPokerSettings,
  type PokerSettings,
} from '../../games/poker'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal as TableModal } from './GameTable'
import { PokerCardFace } from './PokerCardFace'
import { PokerResultView } from './PokerResultView'
import './PokerStage.css'

type PokerGame = Pick<
  ReturnType<typeof useRoomPoker>,
  'state' | 'hand' | 'error' | 'clearError' | 'participantCount' | 'start' | 'act' | 'nextHand' | 'reset'
>
interface Props {
  game: PokerGame
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}
const chips = (value: number) => value.toLocaleString('pt-BR')
const GameModal = (props: ComponentProps<typeof TableModal>) => <TableModal {...props} className="poker-modal" />
const positions: Record<number, Array<[number, number]>> = {
  2: [
    [50, 87],
    [50, 12],
  ],
  3: [
    [50, 87],
    [16, 22],
    [84, 22],
  ],
  4: [
    [50, 87],
    [12, 47],
    [50, 12],
    [88, 47],
  ],
  5: [
    [50, 87],
    [12, 63],
    [26, 13],
    [74, 13],
    [88, 63],
  ],
  6: [
    [50, 87],
    [12, 68],
    [16, 24],
    [50, 10],
    [84, 24],
    [88, 68],
  ],
}
export const PokerStage = ({ game, participants, onExit, onOpenGameHub }: Props) => {
  const { state } = game
  const [modal, setModal] = useState<'rules' | 'settings' | 'history' | 'result' | 'end' | null>(null)
  const [settings, setSettings] = useState<PokerSettings>(defaultPokerSettings)
  const [draftSettings, setDraftSettings] = useState<PokerSettings>(defaultPokerSettings)
  const [raising, setRaising] = useState(false)
  const [raiseTotal, setRaiseTotal] = useState(20)
  const [submittedTurn, setSubmittedTurn] = useState('')
  const [now, setNow] = useState(Date.now)
  const identity = participants.find((p) => p.isLocal)?.id ?? ''
  const local = state.players.find((p) => p.identity === identity)
  const legal = pokerLegalActions(state, identity)
  const seats = arrangeSeats(state.players, identity)
  const result = state.result,
    ended = state.phase === 'hand-result' || state.phase === 'finished'
  const busy = submittedTurn === state.turnId && !game.error
  const raiseMin = Math.min(legal.minRaise, legal.maxTotal),
    raiseValue = Math.max(raiseMin, Math.min(raiseTotal, legal.maxTotal))
  const callLabel = !legal.toCall
    ? 'Check'
    : legal.callAmount === local?.stack
      ? `All-in ${chips(legal.callAmount)}`
      : `Call ${chips(legal.callAmount)}`
  const totalPot = result ? result.pots.reduce((total, pot) => total + pot.amount, 0) : pokerPotTotal(state)
  const winningCards = new Set(Object.keys(result?.payouts ?? {}).flatMap((id) => result?.bestCards[id] ?? []))
  const personalBest =
    game.hand.length === 2 && state.board.length >= 3 ? evaluatePokerHand([...game.hand, ...state.board]).name : ''
  const currentName = state.players.find((p) => p.identity === state.current)?.name ?? ''
  const seconds = state.turnExpiresAt ? Math.max(0, Math.ceil((state.turnExpiresAt - now) / 1000)) : null
  const winners = state.players.filter((p) => (result?.payouts[p.identity] ?? 0) > 0)
  const resultLabel =
    winners.length === 1
      ? `${winners[0]!.name} levou ${chips(result!.payouts[winners[0]!.identity]!)} fichas`
      : winners.length > 1
        ? 'Potes distribuídos'
        : 'Mesa encerrada'
  const street = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' }[state.street]
  useEffect(() => {
    if (!state.turnExpiresAt || state.phase !== 'playing') return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [state.turnExpiresAt, state.phase])
  useEffect(() => {
    setRaising(false)
    setSubmittedTurn('')
  }, [state.gameId, state.turnId])
  const act = (action: Parameters<PokerGame['act']>[0]) => {
    if (busy) return
    if (game.act(action)) {
      setSubmittedTurn(state.turnId)
      setRaising(false)
    }
  }
  const presets = [
    { label: '½ pote', value: state.currentBet + Math.floor((totalPot + legal.toCall) / 2) },
    { label: 'Pote', value: state.currentBet + totalPot + legal.toCall },
    { label: 'All-in', value: legal.maxTotal },
  ]
  return (
    <section
      aria-label="Poker Texas Hold’em"
      className={`poker-stage ${state.phase === 'lobby' ? 'poker-stage--lobby' : ''}`}
    >
      <GameHud
        onExit={onExit}
        onOpenGameHub={onOpenGameHub}
        subtitle={
          state.phase === 'lobby'
            ? '2–6 jogadores'
            : `Mão ${state.handNumber} · ${chips(state.settings.bigBlind / 2)}/${chips(state.settings.bigBlind)}`
        }
        title="Poker"
      >
        <button
          aria-label="Regras do poker"
          className="game-icon-button"
          onClick={() => setModal('rules')}
          type="button"
        >
          ?
        </button>
      </GameHud>
      <GameError error={game.error} onClose={game.clearError} />
      {state.phase === 'lobby' ? (
        <GameLobby
          art={
            <>
              <span className="poker-lobby-card">
                <PokerCardFace card="As" />
              </span>
              <span className="poker-lobby-card">
                <PokerCardFace card="Ah" />
              </span>
              <span className="poker-lobby-chips" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </>
          }
          description="Duas cartas na mão. Cinco na mesa. Faça sua aposta e jogue a melhor combinação."
          disabled={game.participantCount < 2 || game.participantCount > 6 || !readPokerSettings(settings)}
          eyebrow="TEXAS HOLD’EM · NO LIMIT"
          title={
            <>
              Bora de
              <br />
              poker?
            </>
          }
          participants={participants}
          note={
            game.participantCount < 2
              ? 'Precisa de mais uma pessoa para abrir a mesa.'
              : game.participantCount > 6
                ? 'A mesa comporta de 2 a 6 pessoas.'
                : `${chips(settings.startingStack)} fichas por pessoa · blinds ${chips(settings.bigBlind / 2)}/${chips(settings.bigBlind)} · sem dinheiro real`
          }
          onSettings={() => {
            setDraftSettings(settings)
            setModal('settings')
          }}
          onRules={() => setModal('rules')}
          onStart={() => game.start(settings)}
        />
      ) : (
        <>
          <div className="poker-arena" data-player-count={seats.length}>
            <div aria-hidden="true" className="poker-felt">
              <span>TEXAS HOLD’EM</span>
            </div>
            <div className="poker-table-tools">
              <span>
                Mão {state.handNumber}
                <i />
                {street}
              </span>
              <div>
                <button
                  aria-label="Histórico desta mão"
                  onClick={() => setModal('history')}
                  title="Histórico desta mão"
                  type="button"
                >
                  <Icon name="chat" />
                </button>
                <button
                  aria-label="Opções da mesa"
                  onClick={() => setModal('end')}
                  title="Opções da mesa"
                  type="button"
                >
                  <Icon name="menu" />
                </button>
              </div>
            </div>
            {seats.map((player, index) => {
              const [x, y] = positions[seats.length]?.[index] ?? [50, 50]
              const active = player.identity === state.current,
                won = (result?.payouts[player.identity] ?? 0) > 0
              const avatar = participants.find((p) => p.id === player.identity)?.avatarDataUrl
              const revealed = state.revealed[player.identity]
              return (
                <div
                  aria-label={`${player.name}, ${chips(player.stack)} fichas${active ? ', sua vez' : ''}${player.folded ? ', desistiu' : ''}`}
                  className={`poker-seat ${active ? 'is-active' : ''} ${player.folded ? 'is-folded' : ''} ${won ? 'is-winner' : ''} ${player.identity === identity ? 'is-local' : ''}`}
                  data-seat-index={index}
                  data-side={x > 60 ? 'right' : x < 40 ? 'left' : 'center'}
                  key={player.identity}
                  style={{ '--seat-x': `${x}%`, '--seat-y': `${y}%` } as CSSProperties}
                >
                  {(revealed || (player.identity !== identity && player.inHand && !player.folded)) && (
                    <span className="poker-seat__cards">
                      {[0, 1].map((card) => (
                        <PokerCardFace card={revealed?.[card]} highlighted={won} key={card} />
                      ))}
                    </span>
                  )}
                  <span className="poker-seat__portrait">
                    {avatar ? (
                      <img alt="" src={avatar} />
                    ) : (
                      <b>
                        {player.name
                          .trim()
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')
                          .toUpperCase()}
                      </b>
                    )}
                    {active && seconds !== null && <span className="poker-seat__timer">{seconds}</span>}
                  </span>
                  <strong className="poker-seat__name" title={player.name}>
                    {player.name}
                  </strong>
                  <span className="poker-seat__stack">
                    {chips(player.stack)}
                    <i aria-hidden="true" className="poker-chip" />
                  </span>
                  <span className={`poker-seat__action ${player.allIn ? 'is-all-in' : ''}`}>
                    {won
                      ? `+${chips(result!.payouts[player.identity]!)}`
                      : player.away
                        ? 'Desconectado'
                        : player.action || '\u00a0'}
                  </span>
                  {player.identity === state.dealer && (
                    <span className="poker-seat__dealer" title="Dealer">
                      D
                    </span>
                  )}
                  {!ended && player.bet > 0 && (
                    <span className="poker-seat__bet">
                      <i className="poker-chip" />
                      {chips(player.bet)}
                      {player.identity === state.smallBlind ? (
                        <small>SB</small>
                      ) : player.identity === state.bigBlind ? (
                        <small>BB</small>
                      ) : null}
                    </span>
                  )}
                </div>
              )
            })}
            <div className="poker-community">
              <button
                aria-label={ended ? 'Ver resultado dos potes' : `Pote de ${chips(totalPot)} fichas. Ver histórico.`}
                className="poker-pot"
                onClick={() => setModal(ended ? 'result' : 'history')}
                type="button"
              >
                <span className="poker-pot__chips" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  {ended ? 'POTE DISTRIBUÍDO' : 'POTE TOTAL'}
                  <strong key={totalPot}>{chips(totalPot)}</strong>
                </span>
              </button>
              <div aria-label="Cartas comunitárias" className="poker-board">
                {Array.from({ length: 5 }, (_, index) => (
                  <span
                    className={`poker-board__slot ${state.board[index] ? 'has-card' : ''}`}
                    key={`${state.gameId}-${index}`}
                  >
                    <span aria-hidden="true">{index < 3 ? 'FLOP' : index === 3 ? 'TURN' : 'RIVER'}</span>
                    {state.board[index] && (
                      <PokerCardFace
                        card={state.board[index]}
                        highlighted={ended && winningCards.has(state.board[index]!)}
                      />
                    )}
                  </span>
                ))}
              </div>
              <p
                aria-live="polite"
                className={`poker-table-message ${ended ? 'is-result' : ''}`}
                key={ended ? `${state.gameId}-result` : state.events.at(-1)?.id}
              >
                {ended ? resultLabel : state.events.at(-1)?.text}
              </p>
            </div>
          </div>
          <div className="poker-console">
            <div className={`poker-own-hand ${local?.folded ? 'is-folded' : ''}`}>
              <div className="poker-own-hand__cards">
                {local?.inHand ? (
                  game.hand.length === 2 ? (
                    game.hand.map((card) => (
                      <PokerCardFace
                        card={card}
                        highlighted={Boolean(result?.bestCards[identity]?.includes(card))}
                        key={`${state.gameId}-${card}`}
                      />
                    ))
                  ) : (
                    <>
                      <PokerCardFace />
                      <PokerCardFace />
                    </>
                  )
                ) : null}
              </div>
              <span>
                <strong>
                  {!local
                    ? 'Assistindo à mesa'
                    : !local.inHand
                      ? 'Fora desta mão'
                      : local.folded
                        ? 'Você deu fold'
                        : 'Sua mão'}
                </strong>
                <small>
                  {personalBest ||
                    (local?.inHand
                      ? 'Só você vê estas cartas'
                      : local
                        ? 'Aguarde a próxima partida'
                        : 'Você não ocupa um assento')}
                </small>
              </span>
            </div>
            <div className="poker-actions">
              {ended ? (
                <>
                  <p className="poker-action-caption">
                    {state.phase === 'finished' ? 'Fim de partida' : 'Mão encerrada'}
                    <button onClick={() => setModal('result')} type="button">
                      Ver resultado <Icon name="chevron" />
                    </button>
                  </p>
                  <div className="poker-action-buttons">
                    <button className="game-action" onClick={onOpenGameHub} type="button">
                      Outros jogos
                    </button>
                    {local && (
                      <button
                        className="game-action game-action--primary"
                        onClick={() => {
                          if (state.phase === 'finished') {
                            game.start(state.settings)
                          } else {
                            game.nextHand()
                          }
                        }}
                        type="button"
                      >
                        {state.phase === 'finished' ? 'Nova partida' : 'Próxima mão'}
                        <Icon name="chevron" />
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p aria-live="polite" className="poker-action-caption">
                    {legal.active ? (
                      busy ? (
                        'Enviando jogada…'
                      ) : (
                        <>
                          Sua vez
                          {seconds !== null && <span className={seconds <= 10 ? 'is-urgent' : ''}>{seconds}s</span>}
                        </>
                      )
                    ) : local?.folded ? (
                      'Você desistiu desta mão'
                    ) : local?.allIn ? (
                      'All-in · aguardando a mesa'
                    ) : (
                      <>
                        Vez de <strong title={currentName}>{currentName}</strong>
                      </>
                    )}
                    <button onClick={() => setModal('rules')} type="button">
                      Regras
                    </button>
                  </p>
                  {legal.active && raising && legal.canRaise && (
                    <div className="poker-raise-controls">
                      <div className="poker-raise-controls__value">
                        <label>
                          Apostar até{' '}
                          <input
                            aria-label="Total da aposta"
                            inputMode="numeric"
                            max={legal.maxTotal}
                            min={raiseMin}
                            onChange={(e) => setRaiseTotal(Number(e.target.value))}
                            step="1"
                            type="number"
                            value={raiseTotal}
                          />
                        </label>
                        <div>
                          {presets.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => setRaiseTotal(Math.max(raiseMin, Math.min(legal.maxTotal, preset.value)))}
                              type="button"
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button aria-label="Cancelar aumento" onClick={() => setRaising(false)} type="button">
                            <Icon name="x" />
                          </button>
                        </div>
                      </div>
                      <input
                        aria-label="Ajustar aposta"
                        max={legal.maxTotal}
                        min={raiseMin}
                        onChange={(e) => setRaiseTotal(Number(e.target.value))}
                        step="1"
                        type="range"
                        value={raiseValue}
                      />
                    </div>
                  )}
                  <div className="poker-action-buttons">
                    <button
                      className="game-action poker-fold"
                      disabled={!legal.active || busy}
                      onClick={() => act({ type: 'fold' })}
                      type="button"
                    >
                      Fold
                    </button>
                    <button
                      className="game-action game-action--primary"
                      disabled={!legal.active || busy}
                      onClick={() => act({ type: legal.canCheck ? 'check' : 'call' })}
                      type="button"
                    >
                      {callLabel}
                    </button>
                    <button
                      className="game-action poker-raise"
                      disabled={
                        !legal.canRaise ||
                        busy ||
                        (raising &&
                          (!Number.isSafeInteger(raiseTotal) || raiseTotal < raiseMin || raiseTotal > legal.maxTotal))
                      }
                      onClick={() => {
                        if (raising) act({ type: 'raise', total: raiseValue })
                        else {
                          setRaiseTotal(raiseMin)
                          setRaising(true)
                        }
                      }}
                      type="button"
                    >
                      {raising
                        ? `${raiseValue === legal.maxTotal ? 'All-in' : 'Apostar'} ${chips(raiseValue)}`
                        : legal.maxTotal < legal.minRaise
                          ? 'All-in'
                          : state.currentBet
                            ? 'Aumentar'
                            : 'Apostar'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {modal === 'settings' ? (
        <GameModal
          detail="As fichas não têm valor real. As mesmas regras valem para toda a mesa."
          onClose={() => setModal(null)}
          title="Configurar poker"
        >
          <div className="poker-settings">
            <label>
              Fichas por pessoa
              <select
                onChange={(e) => setDraftSettings((current) => ({ ...current, startingStack: Number(e.target.value) }))}
                value={draftSettings.startingStack}
              >
                {[500, 1000, 2000, 5000, 10000].map((value) => (
                  <option key={value} value={value}>
                    {chips(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Blinds
              <select
                onChange={(e) => setDraftSettings((current) => ({ ...current, bigBlind: Number(e.target.value) }))}
                value={draftSettings.bigBlind}
              >
                {[10, 20, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {chips(value / 2)}/{chips(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tempo por jogada
              <select
                onChange={(e) => setDraftSettings((current) => ({ ...current, turnSeconds: Number(e.target.value) }))}
                value={draftSettings.turnSeconds}
              >
                {[0, 30, 60, 90].map((value) => (
                  <option key={value} value={value}>
                    {value ? `${value} segundos` : 'Sem limite'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!readPokerSettings(draftSettings) && (
            <p className="game-modal__hint">Use pelo menos dez big blinds de fichas iniciais.</p>
          )}
          <p className="game-modal__hint">
            Ao acabar o tempo: check se puder passar, fold se houver uma aposta. Os blinds são fixos e o dealer gira a
            cada mão.
          </p>
          <div className="game-modal__actions">
            <button
              className="game-action game-action--primary"
              disabled={!readPokerSettings(draftSettings)}
              onClick={() => {
                setSettings({ ...draftSettings })
                setModal(null)
              }}
              type="button"
            >
              Salvar regras
            </button>
          </div>
        </GameModal>
      ) : modal === 'rules' ? (
        <GameModal onClose={() => setModal(null)} title="Texas Hold’em · No Limit">
          <div className="game-rules poker-rules">
            <p>
              Cada pessoa recebe <strong>duas cartas privadas</strong>. O flop abre três cartas na mesa; turn e river
              abrem uma cada. Vence a melhor combinação de cinco usando qualquer combinação das sete cartas — inclusive
              só as da mesa.
            </p>
            <p>
              <strong>Fold</strong> desiste da mão. <strong>Check</strong> passa sem apostar, quando possível.{' '}
              <strong>Call</strong> paga a aposta. <strong>Aumentar</strong> define o valor total que você quer colocar
              nesta rodada. Você pode ir all-in com todas as suas fichas.
            </p>
            <p>
              O aumento mínimo acompanha o último aumento completo. Um all-in curto não reabre o aumento para quem já
              agiu, a menos que aumentos cumulativos atinjam esse mínimo.
            </p>
            <p>
              All-ins desiguais criam potes separados: você disputa apenas o que cobriu. Empates dividem o pote; naipes
              não desempatam. Valores não cobertos voltam ao dono.
            </p>
            <ol>
              {[
                'Royal / straight flush',
                'Quadra',
                'Full house',
                'Flush',
                'Sequência',
                'Trinca',
                'Dois pares',
                'Um par',
                'Carta alta',
              ].map((rank) => (
                <li key={rank}>{rank}</li>
              ))}
            </ol>
            <p>
              De 2 a 6 pessoas. As fichas são fictícias e não ficam salvas entre partidas. Quem entrar depois assiste;
              sair da call dá fold, exceto se já estiver all-in. Se quem distribui as cartas sair, a mesa é encerrada.
            </p>
          </div>
        </GameModal>
      ) : modal === 'history' ? (
        <GameModal
          detail={`Mão ${state.handNumber} · blinds ${state.settings.bigBlind / 2}/${state.settings.bigBlind}`}
          onClose={() => setModal(null)}
          title="Jogadas desta mão"
        >
          <ol className="poker-history">
            {state.events.map((event) => (
              <li key={event.id}>
                <span>
                  {event.identity ? state.players.find((p) => p.identity === event.identity)?.name.slice(0, 1) : '♠'}
                </span>
                {event.text}
              </li>
            ))}
          </ol>
        </GameModal>
      ) : modal === 'result' && result ? (
        <GameModal
          detail={result.uncontested ? 'A mão terminou sem showdown.' : 'As melhores cinco cartas decidem cada pote.'}
          onClose={() => setModal(null)}
          title="Resultado da mão"
        >
          <PokerResultView state={state} />
        </GameModal>
      ) : modal === 'end' ? (
        <GameModal
          detail="A mesa continua ativa enquanto você navega pela central ou pela call."
          onClose={() => setModal(null)}
          title="Opções da mesa"
        >
          <div className="poker-menu">
            <button className="game-action" onClick={() => setModal('rules')} type="button">
              Como jogar
            </button>
            <button className="game-action" onClick={() => setModal('history')} type="button">
              Histórico da mão
            </button>
            <button
              className="game-action"
              onClick={() => {
                setModal(null)
                onOpenGameHub()
              }}
              type="button"
            >
              Central de jogos
            </button>
          </div>
          <p className="game-modal__hint">
            Encerrar fecha esta mesa para todos e descarta as fichas da partida.
          </p>
          <div className="game-modal__actions">
            <button className="game-action" onClick={() => setModal(null)} type="button">
              Continuar jogando
            </button>
            <button
              className="game-action game-action--danger"
              onClick={() => {
                if (game.reset()) setModal(null)
              }}
              type="button"
            >
              Encerrar mesa
            </button>
          </div>
        </GameModal>
      ) : null}
    </section>
  )
}
