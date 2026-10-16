import { useEffect, useState, type CSSProperties } from 'react'
import type { useRoomCoup } from '../../hooks/useRoomCoup'
import {
  COUP_ACTIONS,
  COUP_ROLES,
  coupActions,
  coupBlockRoles,
  coupResponders,
  coupRoles,
  defaultCoupSettings,
} from '../../games/coup'
import type { CoupAction, CoupPlayer, CoupRole, CoupSettings } from '../../games/coup'
import type { ParticipantMedia } from '../../types'
import { Icon } from '../ui/Icon'
import { arrangeSeats, GameError, GameHud, GameModal } from './GameTable'
import './CoupStage.css'
import { useGameMotion } from './useGameMotion'
import { AnimatedNumber } from './AnimatedNumber'

type Game = Pick<
  ReturnType<typeof useRoomCoup>,
  'state' | 'hand' | 'exchange' | 'error' | 'clearError' | 'participantCount' | 'start' | 'move' | 'reset'
>
interface Props {
  game: Game
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}
export const CoupCardFace = ({
  role,
  small = false,
  revealed = false,
}: {
  role?: CoupRole
  small?: boolean
  revealed?: boolean
}) => (
  <span
    className={`coup-card ${role ? `coup-card--${role}` : 'coup-card--back'} ${small ? 'coup-card--small' : ''} ${revealed ? 'is-revealed' : ''}`}
    style={{ '--role-color': role ? coupRoles[role].color : '#d1b780' } as CSSProperties}
  >
    {role ? (
      <>
        <img alt="" draggable={false} src={`/assets/coup/${role}.webp`} />
        <i>{coupRoles[role].symbol}</i>
        <span className="coup-card__caption">
          <small>{revealed ? 'REVELADO' : 'CORTE KIWI'}</small>
          <strong>{coupRoles[role].name.replace(' Kiwi', '')}</strong>
        </span>
      </>
    ) : (
      <>
        <span className="coup-card__ornament">❧</span>
        <strong>COUP</strong>
        <small>CORTE KIWI</small>
        <span className="coup-card__ornament">❧</span>
      </>
    )}
  </span>
)
const positions: Record<number, Array<[number, number]>> = {
  2: [
    [50, 89],
    [50, 14],
  ],
  3: [
    [50, 89],
    [21, 17],
    [79, 17],
  ],
  4: [
    [50, 89],
    [12, 49],
    [50, 13],
    [88, 49],
  ],
  5: [
    [50, 89],
    [10, 59],
    [28, 14],
    [72, 14],
    [90, 59],
  ],
  6: [
    [50, 89],
    [11, 66],
    [17, 19],
    [50, 10],
    [83, 19],
    [89, 66],
  ],
}
const initial = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase()
const Coin = ({ value }: { value: number }) => (
  <span className="coup-coins" aria-label={`${value} moedas`}>
    <i aria-hidden="true" key={value}>◈</i>
    <b><AnimatedNumber value={value} /></b>
  </span>
)
const Portrait = ({ player, avatar }: { player: { name: string }; avatar?: string }) => (
  <span className="coup-portrait">
    {avatar ? <img alt="" src={avatar} /> : <b>{initial(player.name)}</b>}
  </span>
)

export const CoupStage = ({ game, participants, onExit, onOpenGameHub }: Props) => {
  const { state, hand } = game
  const localId = participants.find((p) => p.isLocal)?.id ?? ''
  const me = state.players.find((p) => p.identity === localId)
  const seats = arrangeSeats(state.players, localId)
  const [modal, setModal] = useState<'rules' | 'history' | 'settings' | 'end' | null>(null)
  const [inspect, setInspect] = useState<CoupRole | null>(null)
  const [targetAction, setTargetAction] = useState<CoupAction | null>(null)
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [dismissedStep, setDismissedStep] = useState('')
  const [privateVisible, setPrivateVisible] = useState(true)
  const motionRef = useGameMotion(`${state.revision}:${hand.map((c) => c.id).join(',')}:${privateVisible}`, state.gameId)
  const [settings, setSettings] = useState<CoupSettings>({ ...defaultCoupSettings })
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!state.expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    setNow(Date.now())
    return () => window.clearInterval(timer)
  }, [state.expiresAt])
  useEffect(() => {
    setSelected([])
    setTargetAction(null)
    setTarget('')
  }, [state.stepId])
  const p = state.pending
  const claimant = p ? (p.claim === 'block' ? p.blocker : p.actor) : ''
  const proofRole = p ? (p.claim === 'block' ? p.blockRole : coupActions[p.action].role) : null
  const decision =
    state.phase === 'proof' && claimant === localId
      ? 'proof'
      : state.phase === 'lose-influence' && state.loss?.identity === localId
        ? 'loss'
        : state.phase === 'exchange' && p?.actor === localId
          ? 'exchange'
          : ''
  const canRespond = coupResponders(state).includes(localId)
  const myTurn = state.phase === 'turn' && state.current === localId
  const forced = Boolean(myTurn && me && me.coins >= 10)
  const isPlaying = Boolean(me?.influence && !me.away)
  const timed = state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) : null
  const decisionSeconds = ['proof', 'lose-influence', 'exchange'].includes(state.phase)
    ? Math.max(45, state.settings.responseSeconds)
    : state.settings.responseSeconds
  const name = (id: string) => state.players.find((p) => p.identity === id)?.name ?? 'Jogador'
  const stageTitle =
    state.phase === 'finished'
      ? state.winner
        ? `${name(state.winner)} venceu`
        : 'Mesa encerrada'
      : myTurn
        ? forced
          ? 'É hora do golpe.'
          : 'Sua vez de jogar.'
        : state.phase === 'turn'
          ? `Vez de ${name(state.current)}`
          : state.phase === 'proof'
            ? `${name(claimant)} precisa provar`
            : state.phase === 'lose-influence'
              ? `${name(state.loss?.identity ?? '')} perde influência`
              : state.phase === 'exchange'
                ? `${name(p?.actor ?? '')} está trocando`
                : state.phase === 'block-challenge'
                  ? 'Alguém contesta o bloqueio?'
                  : state.phase === 'block-response'
                    ? 'Vai deixar passar?'
                    : 'Verdade ou blefe?'
  const openAction = (action: CoupAction) => {
    if (coupActions[action].targeted) {
      setTargetAction(action)
      setTarget('')
    } else game.move({ type: 'act', action })
  }
  const toggleCard = (id: string, count: number) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : count === 1
          ? [id]
          : current.length < count
            ? [...current, id]
            : current,
    )
  const cardChoices =
    decision === 'exchange'
      ? [...hand, ...game.exchange]
      : decision === 'proof'
        ? hand.filter((c) => c.role === proofRole)
        : hand
  const needed = decision === 'exchange' ? (me?.influence ?? 0) : 1
  const selectCards = () => {
    const ok =
      decision === 'exchange'
        ? game.move({ type: 'exchange', keep: selected })
        : game.move({ type: decision === 'proof' ? 'prove' : 'lose', cardId: selected[0]! })
    if (ok) setDismissedStep(state.stepId)
  }
  const seat = (person: CoupPlayer, index: number) => {
    const [x, y] = positions[seats.length]?.[index] ?? [50, 50]
    const avatar = participants.find((p) => p.id === person.identity)?.avatarDataUrl
    const active = state.current === person.identity && state.phase !== 'finished'
    const responding = state.phase !== 'turn' && coupResponders(state).includes(person.identity)
    return (
      <div
        key={person.identity}
        className={`coup-seat ${active ? 'is-active' : ''} ${person.influence ? '' : 'is-out'} ${person.identity === localId ? 'is-local' : ''}`}
        style={{ '--seat-x': `${x}%`, '--seat-y': `${y}%` } as CSSProperties}
        aria-label={`${person.name}, ${person.coins} moedas, ${person.influence} influências`}
      >
        <span className="coup-seat__influences" aria-label="Influências públicas">
          {Array.from({ length: person.influence }, (_, i) => (
            <CoupCardFace key={`back-${i}`} small />
          ))}
          {person.revealed.map((c) => (
            <button
              aria-label={`${person.name} revelou ${coupRoles[c.role].name}`}
              key={c.id}
              onClick={() => setInspect(c.role)}
              type="button"
            >
              <CoupCardFace role={c.role} small revealed />
            </button>
          ))}
        </span>
        <Portrait player={person} avatar={avatar} />
        <Coin value={person.coins} />
        <strong className="coup-seat__name" title={person.name}>
          {person.name}
        </strong>
        <small>
          {person.away
            ? 'Saiu da mesa'
            : !person.influence
              ? 'Fora da corte'
              : responding
                ? 'Decidindo…'
                : active
                  ? 'Na vez'
                  : `${person.influence} influências`}
        </small>
      </div>
    )
  }
  return (
    <section
      aria-label="Coup · Corte Kiwi"
      className={`game-match coup-stage ${state.phase === 'lobby' ? 'coup-stage--lobby' : ''}`}
      ref={motionRef}
    >
      <GameHud title="Coup" subtitle="Corte Kiwi" onExit={onExit} onOpenGameHub={onOpenGameHub}>
        <button
          aria-label="Como jogar Coup"
          className="game-icon-button"
          onClick={() => setModal('rules')}
          title="Como jogar"
          type="button"
        >
          ?
        </button>
        {state.gameId && (
          <button
            aria-label="Histórico da partida"
            className="game-icon-button"
            onClick={() => setModal('history')}
            title="Histórico"
            type="button"
          >
            <Icon name="menu" />
          </button>
        )}
      </GameHud>
      <GameError error={game.error} onClose={game.clearError} />
      {state.phase === 'lobby' ? (
        <div className="coup-lobby">
          <div className="coup-lobby__art" aria-hidden="true">
            {(['captain', 'duke', 'contessa'] as const).map((r) => (
              <CoupCardFace key={r} role={r} />
            ))}
          </div>
          <div className="coup-lobby__copy">
            <span>BLEFE · INFLUÊNCIA · PODER</span>
            <h1>
              COUP<span>CORTE KIWI</span>
            </h1>
            <p>Duas cartas. Nenhuma obrigação de dizer a verdade.</p>
            <div className="coup-lobby__people">
              {participants.slice(0, 6).map((person) => (
                <span key={person.id} title={person.name}>
                  {person.avatarDataUrl ? (
                    <img alt={person.name} src={person.avatarDataUrl} />
                  ) : (
                    initial(person.name)
                  )}
                </span>
              ))}
              <small>{game.participantCount}/6 na mesa</small>
            </div>
            <div className="coup-lobby__actions">
              <button className="coup-button" onClick={() => setModal('settings')} type="button">
                <Icon name="controls" />
                Opções
              </button>
              <button
                className="coup-button coup-button--gold"
                disabled={game.participantCount < 2 || game.participantCount > 6}
                onClick={() => game.start(settings)}
                type="button"
              >
                <Icon name="play" />
                Distribuir cartas
              </button>
            </div>
            <small className="coup-lobby__note">
              {game.participantCount < 2
                ? 'Convide mais uma pessoa para jogar.'
                : game.participantCount > 6
                  ? 'O jogo clássico comporta até 6 pessoas.'
                  : '2–6 pessoas · 15 minutos · regras clássicas'}
            </small>
          </div>
        </div>
      ) : (
        <>
          <div className="coup-table" data-phase={state.phase}>
            <div className="coup-table__felt" aria-hidden="true">
              <span>
                COUP<small>CORTE KIWI</small>
              </span>
            </div>
            {seats.map(seat)}
            <div className={`coup-center ${p ? 'has-action' : ''}`} key={state.events.at(-1)?.id ?? 'start'}>
              {p && proofRole ? (
                <span className="coup-center__claim" data-game-card={`claim-${state.events.at(-1)?.id}`}>
                  <CoupCardFace role={proofRole} />
                  <small>{p.claim === 'block' ? 'BLOQUEIO ALEGADO' : 'PERSONAGEM ALEGADO'}</small>
                </span>
              ) : (
                <span className="coup-center__deck">
                  <CoupCardFace />
                  <small>{state.deckCount} na corte</small>
                </span>
              )}
              <div className="coup-center__announcement" aria-live="polite">
                <span>
                  {state.phase === 'finished'
                    ? 'ÚLTIMO KIWI DE PÉ'
                    : p
                      ? p.claim === 'block'
                        ? 'BLOQUEIO'
                        : coupActions[p.action].name.toUpperCase()
                      : `TURNO ${state.turn}`}
                </span>
                <h2>{stageTitle}</h2>
                <p>
                  {state.events.at(-1)?.text ||
                    'Você pode alegar qualquer personagem. Inclusive os que não tem.'}
                </p>
                {timed !== null && (
                  <span className="coup-timer" role="timer" aria-label={`${timed} segundos restantes`}>
                    <i
                      style={
                        {
                          '--timer-width': `${Math.min(100, (timed / Math.max(1, decisionSeconds)) * 100)}%`,
                        } as CSSProperties
                      }
                    />
                    {timed}s para decidir
                  </span>
                )}
                {state.phase === 'finished' && (
                  <button
                    className="coup-button coup-button--gold"
                    disabled={game.participantCount < 2 || game.participantCount > 6}
                    onClick={() => game.start(state.settings)}
                    type="button"
                  >
                    Jogar de novo
                  </button>
                )}
              </div>
            </div>
            <span className="coup-treasury" title="Moedas no tesouro">
              <Coin value={state.treasury} />
              <small>Tesouro</small>
            </span>
          </div>
          <div className="coup-bottom">
            <div className="coup-hand">
              <header>
                <span>SUAS INFLUÊNCIAS</span>
                <button
                  aria-label={privateVisible ? 'Ocultar minhas cartas' : 'Mostrar minhas cartas'}
                  onClick={() => setPrivateVisible(!privateVisible)}
                  title={privateVisible ? 'Ocultar cartas' : 'Mostrar cartas'}
                  type="button"
                >
                  <Icon name={privateVisible ? 'eye' : 'eyeOff'} />
                </button>
              </header>
              <div className="coup-hand__cards">
                {hand.map((c) => (
                  <button
                    aria-label={privateVisible ? `Ver ${coupRoles[c.role].name}` : 'Carta oculta'}
                    key={c.id}
                    data-game-card={c.id}
                    data-game-revealed={privateVisible}
                    onClick={() => privateVisible && setInspect(c.role)}
                    type="button"
                  >
                    <CoupCardFace role={privateVisible ? c.role : undefined} />
                  </button>
                ))}
                {!hand.length && <p>{me ? 'Suas cartas foram reveladas.' : 'Você está assistindo.'}</p>}
              </div>
            </div>
            <div className="coup-controls">
              <header>
                <strong>
                  {myTurn
                    ? forced
                      ? 'Golpe obrigatório · 10+ moedas'
                      : 'Escolha sua ação'
                    : decision
                      ? 'Sua decisão é necessária'
                      : canRespond
                        ? 'A mesa espera sua resposta'
                        : isPlaying
                          ? 'Acompanhe a mesa'
                          : 'Você está assistindo'}
                </strong>
                <button onClick={() => setModal('end')} type="button">
                  Encerrar mesa
                </button>
              </header>
              {myTurn ? (
                <div className="coup-actions">
                  {COUP_ACTIONS.map((action) => (
                    <button
                      className={`coup-action ${action === 'coup' ? 'coup-action--coup' : ''}`}
                      disabled={(forced && action !== 'coup') || (me?.coins ?? 0) < coupActions[action].cost}
                      key={action}
                      onClick={() => openAction(action)}
                      title={coupActions[action].detail}
                      type="button"
                    >
                      <i
                        style={{
                          color: coupActions[action].role
                            ? coupRoles[coupActions[action].role!].color
                            : undefined,
                        }}
                      >
                        {coupActions[action].symbol}
                      </i>
                      <span>
                        <strong>{coupActions[action].name}</strong>
                        <small>
                          {coupActions[action].role
                            ? coupRoles[coupActions[action].role!].name.replace(' Kiwi', '')
                            : action === 'coup'
                              ? '7 moedas'
                              : 'Sem personagem'}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : decision ? (
                <div className="coup-response">
                  <p>
                    {decision === 'proof'
                      ? 'Mostre o personagem alegado ou aceite perder uma influência.'
                      : decision === 'exchange'
                        ? `Escolha ${me?.influence} carta(s) para ficar. As outras voltam à corte.`
                        : 'Escolha a influência que deseja revelar.'}
                  </p>
                  <button
                    className="coup-button coup-button--gold"
                    onClick={() => setDismissedStep('')}
                    type="button"
                  >
                    {decision === 'proof'
                      ? 'Responder contestação'
                      : decision === 'exchange'
                        ? 'Escolher cartas'
                        : 'Revelar influência'}
                  </button>
                </div>
              ) : canRespond ? (
                <div className="coup-response">
                  <p>
                    {state.phase === 'block-response'
                      ? p?.action === 'assassinate'
                        ? 'A Condessa pode impedir este assassinato.'
                        : p?.action === 'steal'
                          ? 'Capitão ou Embaixador podem impedir o roubo.'
                          : 'Qualquer rival pode alegar Duque para bloquear.'
                      : 'Você pode contestar. Quem perder revela uma influência.'}
                  </p>
                  <div className="coup-response__buttons">
                    <button className="coup-button" onClick={() => game.move({ type: 'pass' })} type="button">
                      {state.phase === 'block-response' ? 'Deixar passar' : 'Não contestar'}
                    </button>
                    {state.phase === 'block-response' ? (
                      coupBlockRoles(p!.action).map((r) => (
                        <button
                          className="coup-button coup-button--gold"
                          key={r}
                          onClick={() => game.move({ type: 'block', role: r })}
                          type="button"
                        >
                          Bloquear · {coupRoles[r].name.replace(' Kiwi', '')}
                        </button>
                      ))
                    ) : (
                      <button
                        className="coup-button coup-button--danger"
                        onClick={() => game.move({ type: 'challenge' })}
                        type="button"
                      >
                        Contestar!
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="coup-waiting">
                  <span className="coup-waiting__sigil">❧</span>
                  <p>
                    {state.phase === 'finished'
                      ? 'Uma nova corte espera por vocês.'
                      : isPlaying
                        ? 'Ouça, observe e prepare seu próximo blefe.'
                        : 'Você pode acompanhar a partida até o fim.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {targetAction && (
        <GameModal
          title={`${coupActions[targetAction].name}: escolha o alvo`}
          detail={coupActions[targetAction].detail}
          onClose={() => setTargetAction(null)}
          className="coup-modal"
        >
          <div className="coup-targets">
            {state.players
              .filter((person) => person.influence && !person.away && person.identity !== localId)
              .map((person) => (
                <button
                  aria-pressed={target === person.identity}
                  className={target === person.identity ? 'is-selected' : ''}
                  key={person.identity}
                  onClick={() => setTarget(person.identity)}
                  type="button"
                >
                  <Portrait
                    player={person}
                    avatar={participants.find((p) => p.id === person.identity)?.avatarDataUrl}
                  />
                  <strong>{person.name}</strong>
                  <small>{person.influence} influências</small>
                  <Coin value={person.coins} />
                </button>
              ))}
          </div>
          <div className="coup-modal__actions">
            <button className="coup-button" onClick={() => setTargetAction(null)} type="button">
              Cancelar
            </button>
            <button
              className="coup-button coup-button--gold"
              disabled={!target}
              onClick={() => {
                if (game.move({ type: 'act', action: targetAction, target })) setTargetAction(null)
              }}
              type="button"
            >
              {coupActions[targetAction].name}
              {coupActions[targetAction].cost ? ` · ${coupActions[targetAction].cost} moedas` : ''}
            </button>
          </div>
        </GameModal>
      )}
      {decision && dismissedStep !== state.stepId && (
        <GameModal
          className="coup-modal"
          wide={decision === 'exchange'}
          title={
            decision === 'proof'
              ? 'Prove sua influência'
              : decision === 'exchange'
                ? 'A corte está em suas mãos'
                : 'Qual influência você revela?'
          }
          detail={
            decision === 'proof'
              ? `Alegação: ${proofRole ? coupRoles[proofRole].name : ''}. A carta comprovada volta à corte e você recebe outra.`
              : decision === 'exchange'
                ? `Mantenha ${needed} carta(s). Apenas você vê esta escolha.`
                : 'Essa carta ficará visível e não poderá mais ser usada.'
          }
          onClose={() => setDismissedStep(state.stepId)}
        >
          <div className="coup-choices">
            {cardChoices.map((c) => (
              <button
                aria-label={`Selecionar ${coupRoles[c.role].name}`}
                aria-pressed={selected.includes(c.id)}
                className={selected.includes(c.id) ? 'is-selected' : ''}
                key={c.id}
                onClick={() => toggleCard(c.id, needed)}
                type="button"
              >
                <CoupCardFace role={c.role} />
                {selected.includes(c.id) && (
                  <span>
                    <Icon name="check" />
                    {decision === 'exchange' ? 'Manter' : 'Selecionada'}
                  </span>
                )}
              </button>
            ))}
          </div>
          {!cardChoices.length && (
            <p className="coup-modal__note">
              {hand.length && decision === 'proof'
                ? 'Você não tem uma influência ativa desse personagem. Aceite a perda para continuar.'
                : 'Sincronizando suas cartas…'}
            </p>
          )}
          <div className="coup-modal__actions">
            {decision === 'proof' && (
              <button
                className="coup-button coup-button--danger"
                onClick={() => {
                  if (game.move({ type: 'concede' })) setDismissedStep(state.stepId)
                }}
                type="button"
              >
                Aceitar perda
              </button>
            )}
            <button
              className="coup-button coup-button--gold"
              disabled={selected.length !== needed || !needed}
              onClick={selectCards}
              type="button"
            >
              {decision === 'proof'
                ? 'Comprovar personagem'
                : decision === 'exchange'
                  ? `Manter ${selected.length}/${needed}`
                  : 'Revelar influência'}
            </button>
          </div>
        </GameModal>
      )}
      {(modal === 'rules' || inspect) && (
        <GameModal
          className="coup-modal"
          wide={!inspect}
          title={inspect ? coupRoles[inspect].name : 'Coup · como jogar'}
          detail={
            inspect
              ? 'Uma das cinco influências da Corte Kiwi.'
              : 'Seja o último kiwi com pelo menos uma influência.'
          }
          onClose={() => {
            setInspect(null)
            setModal(null)
          }}
        >
          {inspect ? (
            <div className="coup-inspect">
              <CoupCardFace role={inspect} />
              <div>
                <h3>{coupRoles[inspect].power}</h3>
                <p>{coupRoles[inspect].block}.</p>
                <p>
                  Você pode alegar esse personagem mesmo sem a carta. Se alguém contestar, comprove ou perca
                  uma influência.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="coup-rule-roles">
                {COUP_ROLES.map((r) => (
                  <button key={r} onClick={() => setInspect(r)} type="button">
                    <CoupCardFace role={r} />
                    <strong>{coupRoles[r].power}</strong>
                    <small>{coupRoles[r].block}</small>
                  </button>
                ))}
              </div>
              <ol className="coup-rules">
                <li>Comece com 2 influências e 2 moedas. Em duelos, quem começa recebe só 1 moeda.</li>
                <li>
                  Na sua vez, escolha uma ação. Renda: +1; ajuda externa: +2; Duque: +3; Assassino: pague 3
                  para tirar influência; Capitão: roube até 2; Embaixador: compre 2 e devolva 2.
                </li>
                <li>
                  Você pode blefar. Qualquer rival pode contestar uma alegação. Quem perde a contestação
                  revela uma influência de sua escolha. Uma carta comprovada é embaralhada na corte e
                  substituída.
                </li>
                <li>
                  Duque bloqueia ajuda externa. Só a vítima pode bloquear roubo (Capitão ou Embaixador) ou
                  assassinato (Condessa). Bloqueios também podem ser blefe e ser contestados.
                </li>
                <li>
                  Golpe custa 7, sempre retira uma influência e não permite defesa. Com 10 moedas ou mais, é
                  obrigatório.
                </li>
                <li>
                  Bloqueio aceito: o custo continua pago. Ação desmentida em contestação: o custo é devolvido.
                  Um assassinato pode tirar duas influências se você perder a contestação e sofrer a ação.
                </li>
                <li>
                  Perdeu as duas influências? Você sai da disputa e suas moedas voltam ao tesouro. O último
                  jogador com influência vence.
                </li>
              </ol>
              <p className="coup-modal__note">
                Adaptação não oficial com arte original. Coup por Rikki Tahta / La Mame Games · Indie Boards &
                Cards.{' '}
                <a
                  href="https://officialgamerules.org/wp-content/uploads/2025/02/Coup-Rulebook.pdf"
                  rel="noreferrer"
                  target="_blank"
                >
                  Livro de regras
                </a>
                .
              </p>
            </>
          )}
        </GameModal>
      )}
      {modal === 'history' && (
        <GameModal className="coup-modal" title="O que aconteceu na corte" onClose={() => setModal(null)}>
          <ol className="coup-history">
            {state.events.map((e) => (
              <li key={e.id}>
                <i>{e.role ? coupRoles[e.role].symbol : e.kind === 'win' ? '♛' : '•'}</i>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </GameModal>
      )}
      {modal === 'settings' && (
        <GameModal
          className="coup-modal"
          title="Opções da mesa"
          detail="Regras clássicas. Sem expansões nesta versão."
          onClose={() => setModal(null)}
        >
          <label className="coup-setting">
            <span>
              Tempo para contestar ou bloquear
              <small>
                Ao acabar, quem não respondeu deixa a ação passar. Escolhas privadas têm no mínimo 45
                segundos.
              </small>
            </span>
            <select
              aria-label="Tempo de resposta"
              onChange={(e) => setSettings({ responseSeconds: Number(e.target.value) })}
              value={settings.responseSeconds}
            >
              {[0, 15, 20, 30, 45].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds ? `${seconds} segundos` : 'Sem limite'}
                </option>
              ))}
            </select>
          </label>
          <p className="coup-modal__note">
            Sair da sala elimina suas influências. Se quem distribui sair, a partida é encerrada; as cartas
            dos outros não são repassadas.
          </p>
        </GameModal>
      )}
      {modal === 'end' && (
        <GameModal
          className="coup-modal"
          title="Encerrar esta mesa?"
          detail="A partida será encerrada para todos. A call continua conectada."
          onClose={() => setModal(null)}
        >
          <div className="coup-modal__actions">
            <button className="coup-button" onClick={() => setModal(null)} type="button">
              Continuar jogando
            </button>
            <button
              className="coup-button coup-button--danger"
              onClick={() => {
                game.reset()
                setModal(null)
              }}
              type="button"
            >
              Encerrar partida
            </button>
          </div>
        </GameModal>
      )}
    </section>
  )
}
