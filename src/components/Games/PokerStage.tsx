import { useEffect, useState, type ComponentProps, type CSSProperties } from 'react'
import type { ParticipantMedia } from '../../types'
import type { useRoomPoker } from '../../hooks/useRoomPoker'
import {
  defaultPokerSettings,
  describePokerHand,
  pokerLegalActions,
  pokerPotTotal,
  POKER_FLOW_TIMING,
  readPokerSettings,
  type PokerSettings,
  type PokerState,
} from '../../games/poker'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameLobby, GameModal as TableModal } from './GameTable'
import { PokerCardFace } from './PokerCardFace'
import { PokerResultView } from './PokerResultView'
import { PokerHandGuide } from './PokerHandGuide'
import { AnimatedNumber } from './AnimatedNumber'
import { PokerMotionLayer } from './PokerMotionLayer'
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
  const [modal, setModal] = useState<'rules' | 'guide' | 'settings' | 'history' | 'result' | 'end' | 'restart' | null>(null)
  const [lastResult, setLastResult] = useState<PokerState | null>(null)
  const [resultSnapshot, setResultSnapshot] = useState<PokerState | null>(null)
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
  const runningOut = state.phase === 'runout'
  const champion = state.phase === 'finished' ? state.players.find((p) => p.stack > 0 && !p.away) : undefined
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
  const personalBest = local?.inHand && !local.folded ? describePokerHand(game.hand, state.board) : null
  const personalCards = new Set(personalBest?.cards)
  const currentName = state.players.find((p) => p.identity === state.current)?.name ?? ''
  const seconds = state.turnExpiresAt ? Math.max(0, Math.ceil((state.turnExpiresAt - now) / 1000)) : null
  const nextSeconds = Math.max(0, Math.ceil((state.transitionAt - now) / 1000))
  const winners = state.players.filter((p) => (result?.payouts[p.identity] ?? 0) > 0)
  const resultLabel =
    winners.length === 1
      ? `${winners[0]!.name} levou ${chips(result!.payouts[winners[0]!.identity]!)} fichas`
      : winners.length > 1
        ? 'Potes distribuídos'
        : 'Mesa encerrada'
  const street = { preflop: 'Pré-flop', flop: 'Flop', turn: 'Turn', river: 'River' }[state.street]
  useEffect(() => {
    if (!state.turnExpiresAt && !state.transitionAt) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [state.turnExpiresAt, state.transitionAt])
  useEffect(() => {
    if (state.result) setLastResult(state)
    else setLastResult((previous) => previous?.matchId === state.matchId ? previous : null)
  }, [state])
  useEffect(() => {
    setRaising(false)
    setSubmittedTurn('')
  }, [state.gameId, state.turnId])
  const openResult = () => {
    const snapshot = state.result ? state : lastResult
    if (!snapshot) return
    setResultSnapshot(snapshot)
    setModal('result')
  }
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
      className={`poker-stage ${state.phase === 'lobby' ? 'poker-stage--lobby' : ''} ${runningOut ? 'is-runout' : ''} ${state.phase === 'finished' ? 'is-finished' : ''}`}
      data-poker-phase={state.phase}
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
            <PokerMotionLayer state={state} locations={Object.fromEntries(seats.map((p, index) => [p.identity, positions[seats.length]?.[index] ?? [50, 50]]))} />
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
                <button className="poker-guide-button" onClick={() => setModal('guide')} type="button">
                  <span aria-hidden="true">♠</span> Combinações
                </button>
                {lastResult && <button aria-label="Ver última mão" onClick={openResult} title="Última mão" type="button"><Icon name="chevron" /></button>}
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
                        <PokerCardFace card={revealed?.[card]} highlighted={won} key={`${state.gameId}-${revealed?.[card] ?? card}`} motion={revealed ? 'flip' : 'deal'} delay={revealed ? card * 100 : index * 90 + card * seats.length * 90} />
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
                    <AnimatedNumber value={player.stack} delay={won ? 800 : 0} />
                    <i aria-hidden="true" className="poker-chip" />
                  </span>
                  <span className={`poker-seat__action ${player.allIn ? 'is-all-in' : ''}`} key={`${state.gameId}-${player.action}-${won}`}>
                    {won
                      ? `+${chips(result!.payouts[player.identity]!)}`
                      : player.away
                        ? 'Desconectado'
                        : player.action || '\u00a0'}
                  </span>
                  {player.identity === state.dealer && (
                    <span className="poker-seat__dealer" title="Dealer" key={`${state.gameId}-dealer`}>
                      D
                    </span>
                  )}
                  {!ended && player.bet > 0 && (
                    <span className="poker-seat__bet" key={`${state.gameId}-${state.street}-${player.bet}`}>
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
                onClick={() => ended ? openResult() : setModal('history')}
                type="button"
              >
                <span className="poker-pot__chips" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  {ended ? 'POTE DISTRIBUÍDO' : 'POTE TOTAL'}
                  <strong><AnimatedNumber value={totalPot} /></strong>
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
                        bestHand={!ended && personalCards.has(state.board[index]!)}
                        highlighted={ended && winningCards.has(state.board[index]!)}
                        motion="flip"
                        delay={index < 3 ? index * 130 : 0}
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
                        bestHand={personalCards.has(card)}
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
                <small
                  aria-atomic="true"
                  aria-live="polite"
                  className={personalBest ? 'poker-hand-strength' : undefined}
                  title={
                    personalBest
                      ? 'Antes do river, a borda indica a combinação. No river, indica as cinco melhores cartas, incluindo as de desempate.'
                      : undefined
                  }
                >
                  {personalBest?.name ||
                    (local?.folded
                      ? 'Suas cartas não participam desta mão'
                      : local?.inHand
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
                    {state.phase === 'finished' ? 'PARTIDA ENCERRADA' : 'Mão encerrada'}
                    <button onClick={openResult} type="button">
                      Ver resultado <Icon name="chevron" />
                    </button>
                  </p>
                  {state.phase === 'finished' ? <div className="poker-finale" key={state.matchId}>
                    <span aria-hidden="true">★</span>
                    <div><small>{champion ? 'CAMPEÃO DA MESA' : 'MESA ENCERRADA'}</small><strong title={champion?.name}>{champion?.name ?? 'Obrigado pela partida'}</strong></div>
                    {local && (
                      <button
                        className="game-action game-action--primary"
                        onClick={() => setModal('restart')}
                        type="button"
                      >
                        Nova partida
                      </button>
                    )}
                  </div> : <div className="poker-next-hand" role="status">
                    <span>Próxima mão em <strong>{nextSeconds}s</strong></span>
                    <div className="poker-next-hand__track"><i style={{ scale: `${Math.min(1, Math.max(0, (state.transitionAt - now) / POKER_FLOW_TIMING.nextHand))} 1` }} /></div>
                    <small>As fichas continuam. O dealer gira.</small>
                  </div>}
                </>
              ) : runningOut ? (
                <div className="poker-runout" role="status">
                  <span className="poker-runout__symbol" aria-hidden="true">♠</span>
                  <div><small>APOSTAS ENCERRADAS</small><strong>{state.street === 'river' ? 'Showdown' : `Vem o ${state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : 'river'}`}</strong><span>{state.street === 'river' ? 'As melhores cinco cartas decidem.' : 'Mãos abertas. Cada carta conta.'}</span></div>
                </div>
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
            <button className="game-action" onClick={() => setModal('guide')} type="button">Ver tabela de combinações</button>
            <p>A próxima mão começa automaticamente após uma pausa para ver o resultado. Quando só resta uma pessoa com fichas, a partida termina: uma nova partida precisa ser iniciada pela mesa.</p>
            <p>
              De 2 a 6 pessoas. As fichas são fictícias e não ficam salvas entre partidas. Quem entrar depois assiste;
              sair da call dá fold, exceto se já estiver all-in. Se quem distribui as cartas sair, a mesa é encerrada.
            </p>
          </div>
        </GameModal>
      ) : modal === 'guide' ? (
        <GameModal detail="Da mais forte à mais fraca. Sua mão final sempre tem cinco cartas." onClose={() => setModal(null)} title="Combinações do poker" wide>
          <PokerHandGuide current={personalBest?.name} />
        </GameModal>
      ) : modal === 'restart' ? (
        <GameModal detail="O resultado desta partida fica na mesa até vocês decidirem começar outra." onClose={() => setModal(null)} title="Começar uma nova partida?">
          <p className="game-modal__hint">Cada pessoa volta a ter {chips(state.settings.startingStack)} fichas. Este é um novo jogo, não a próxima mão.</p>
          <div className="game-modal__actions">
            <button className="game-action" onClick={() => setModal(null)} type="button">Manter resultado</button>
            <button className="game-action game-action--primary" onClick={() => { if (game.start(state.settings)) setModal(null) }} type="button">Iniciar nova partida</button>
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
      ) : modal === 'result' && resultSnapshot?.result ? (
        <GameModal
          detail={resultSnapshot.result.uncontested ? 'A mão terminou sem showdown.' : 'As melhores cinco cartas decidem cada pote.'}
          onClose={() => setModal(null)}
          title={`Resultado · mão ${resultSnapshot.handNumber}`}
        >
          <PokerResultView state={resultSnapshot} />
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
