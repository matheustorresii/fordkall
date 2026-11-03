import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ParticipantMedia } from '../../types'
import type { useRoomOdin } from '../../hooks/useRoomOdin'
import {
  defaultOdinSettings,
  ODIN_CLANS,
  odinClans,
  odinPlayError,
  odinValue,
  type OdinCard,
  type OdinSettings,
} from '../../games/odin'
import { Icon } from '../ui/Icon'
import {
  arrangeSeats,
  GameError,
  GameHud,
  GameLobby,
  GameModal,
  GameSeat,
} from './GameTable'
import { OdinCardFace } from './OdinCard'
import './OdinStage.css'

type Props = {
  game: ReturnType<typeof useRoomOdin>
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}
const cardLabel = (card: OdinCard) =>
  `${card.value} de ${odinClans[card.clan].name}`
const Seconds = ({ until }: { until: number }) => {
  const [time, setTime] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setTime(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])
  return <span>{Math.max(0, Math.ceil((until - time) / 1000))}s</span>
}

export const OdinStage = ({
  game,
  participants,
  onExit,
  onOpenGameHub,
}: Props) => {
  const { state, hand } = game
  const localId = participants.find((p) => p.isLocal)?.id || ''
  const me = state.players.find((p) => p.identity === localId)
  const myTurn = state.phase === 'playing' && state.current === localId
  const [modal, setModal] = useState<
    'rules' | 'settings' | 'score' | 'end' | null
  >(null)
  const [settings, setSettings] = useState<OdinSettings>(defaultOdinSettings)
  const [selection, setSelection] = useState<{ step: string; ids: string[] }>({
    step: '',
    ids: [],
  })
  const [capture, setCapture] = useState<{
    step: string
    ids: string[]
  } | null>(null)
  const [pending, setPending] = useState<{
    step: string
    revision: number
  } | null>(null)
  const [sort, setSort] = useState<'number' | 'clan'>('clan')
  const selected =
    selection.step === state.stepId
      ? selection.ids.filter((id) => hand.some((c) => c.id === id))
      : []
  const selectedCards = hand.filter((c) => selected.includes(c.id))
  const selectionError = selected.length
    ? odinPlayError(hand, state.center, selected)
    : null
  const waiting =
    pending?.step === state.stepId && pending.revision === state.revision
  const choosingCapture =
    capture?.step === state.stepId && myTurn ? capture : null
  const seats = arrangeSeats(state.players, localId)
  const sortedHand = useMemo(
    () =>
      [...hand].sort((a, b) =>
        sort === 'number'
          ? b.value - a.value ||
            ODIN_CLANS.indexOf(a.clan) - ODIN_CLANS.indexOf(b.clan)
          : ODIN_CLANS.indexOf(a.clan) - ODIN_CLANS.indexOf(b.clan) ||
            b.value - a.value,
      ),
    [hand, sort],
  )
  useEffect(() => {
    if (game.error) setPending(null)
  }, [game.error])
  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => setPending(null), 5000)
    return () => clearTimeout(timer)
  }, [pending])
  const send = (ids: string[], takeId?: string) => {
    game.clearError()
    if (
      game.move({ type: 'play', cardIds: ids, ...(takeId ? { takeId } : {}) })
    ) {
      setPending({ step: state.stepId, revision: state.revision })
      setCapture(null)
    }
  }
  const play = () => {
    if (!selected.length || selectionError || !myTurn || waiting) return
    if (state.center.length > 1 && selected.length < hand.length)
      setCapture({ step: state.stepId, ids: selected })
    else send(selected)
  }
  const name = (id: string) =>
    state.players.find((p) => p.identity === id)?.name || 'Jogador'
  const finished = state.phase === 'finished'
  const results = state.phase === 'hand-result' || finished
  const cardSample: OdinCard[] = [
    { id: 'leaf-9', clan: 'leaf', value: 9 },
    { id: 'sun-8', clan: 'sun', value: 8 },
    { id: 'tide-7', clan: 'tide', value: 7 },
  ]
  return (
    <section
      aria-label="Mesa de ODIN"
      className={`game-match odin-stage ${state.phase === 'lobby' ? 'odin-stage--lobby' : ''}`}
    >
      <GameHud
        title="ODIN"
        subtitle={
          state.gameId
            ? `Mão ${state.handNumber} · ${state.settings.singleHand ? 'mão única' : `${state.settings.pointLimit} pontos`}`
            : 'Clãs Kiwi · 2–6 pessoas'
        }
        onExit={onExit}
        onOpenGameHub={onOpenGameHub}
      >
        <button
          aria-label="Placar de ODIN"
          className="game-icon-button"
          onClick={() => setModal('score')}
          title="Placar"
          type="button"
        >
          <Icon name="users" />
        </button>
        <button
          aria-label="Como jogar ODIN"
          className="game-icon-button"
          onClick={() => setModal('rules')}
          title="Como jogar"
          type="button"
        >
          ?
        </button>
      </GameHud>
      <GameError error={game.error} onClose={game.clearError} />
      {state.phase === 'lobby' ? (
        <GameLobby
          title={
            <>
              ODIN<span className="odin-lobby-subtitle">Clãs Kiwi</span>
            </>
          }
          eyebrow="CARTAS · 2–6 PESSOAS"
          description="Combine cores ou números. Supere a mesa. Livre-se das suas cartas antes dos outros."
          art={
            <div className="odin-lobby-cards">
              {cardSample.map((c) => (
                <OdinCardFace card={c} key={c.id} />
              ))}
            </div>
          }
          participants={participants}
          disabled={game.participantCount < 2 || game.participantCount > 6}
          onStart={() => game.start(settings)}
          onRules={() => setModal('rules')}
          onSettings={() => setModal('settings')}
          note="9 cartas por pessoa. Quanto menos pontos, melhor."
        />
      ) : (
        <>
          <div
            className={`game-arena odin-arena ${results ? 'odin-arena--result' : ''}`}
          >
            <div aria-hidden="true" className="odin-table">
              <div className="odin-table__mark">
                ODIN<span>CLÃS KIWI</span>
              </div>
            </div>
            <button
              className="odin-score-button"
              onClick={() => setModal('score')}
              type="button"
            >
              Mão {state.handNumber}
              <span>
                {state.settings.singleHand
                  ? 'Mão única'
                  : `Até ${state.settings.pointLimit} pts`}
              </span>
            </button>
            {seats.map((p, index) => (
              <GameSeat
                key={p.identity}
                name={p.name}
                avatar={
                  participants.find((person) => person.id === p.identity)
                    ?.avatarDataUrl
                }
                cards={p.cardsRemaining}
                index={index}
                total={seats.length}
                local={p.identity === localId}
                active={!results && p.identity === state.current}
                eliminated={p.away}
                status={
                  p.away
                    ? 'Só assistindo'
                    : state.passes.includes(p.identity)
                      ? 'Passou'
                      : state.lastPlay?.actor === p.identity &&
                          state.lastPlay.taken &&
                          !state.passes.length
                        ? `Pegou ${state.lastPlay.taken.value}${odinClans[state.lastPlay.taken.clan].symbol} · ${p.score} pts`
                        : `${p.score} pts`
                }
              />
            ))}
            <div className="odin-center">
              {results ? (
                <div aria-live="polite" className="odin-result">
                  <span>
                    {finished
                      ? state.finishReason === 'not-enough-players'
                        ? 'MESA ENCERRADA'
                        : 'FIM DA PARTIDA'
                      : `MÃO ${state.handNumber} ENCERRADA`}
                  </span>
                  <h2>
                    {finished
                      ? state.winners.length
                        ? `${state.winners.map(name).join(' e ')} ${state.winners.length > 1 ? 'venceram' : 'venceu'}`
                        : 'Até a próxima.'
                      : `${name(state.result!.winner)} fechou!`}
                  </h2>
                  <div className="odin-result__scores">
                    {state.players
                      .filter((p) => !p.away)
                      .map((p) => (
                        <span key={p.identity} title={p.name}>
                          <b>
                            {p.score}
                            <small> pts</small>
                          </b>
                          <strong>{p.name}</strong>
                          {state.result && (
                            <i>
                              +
                              {state.result.entries.find(
                                (e) => e.identity === p.identity,
                              )?.penalty || 0}{' '}
                              nesta mão
                            </i>
                          )}
                        </span>
                      ))}
                  </div>
                  {finished ? (
                    <button
                      className="game-action game-action--primary"
                      disabled={
                        game.participantCount < 2 || game.participantCount > 6
                      }
                      onClick={() => game.start(state.settings)}
                      type="button"
                    >
                      Nova partida
                    </button>
                  ) : (
                    <button
                      className="game-action"
                      onClick={() => game.nextHand()}
                      type="button"
                    >
                      Próxima mão <Seconds until={state.transitionAt} />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div
                    aria-live="polite"
                    className={`odin-turn ${myTurn ? 'is-yours' : ''}`}
                  >
                    <i />
                    {myTurn ? 'Sua vez' : `Vez de ${name(state.current)}`}
                    {Boolean(state.turnExpiresAt) && (
                      <Seconds until={state.turnExpiresAt} />
                    )}
                  </div>
                  {state.center.length ? (
                    <div
                      className="odin-center__play"
                      key={state.lastPlay?.id || state.stepId}
                    >
                      <div
                        className="odin-center__cards"
                        style={
                          {
                            '--played-count': state.center.length,
                          } as CSSProperties
                        }
                      >
                        {state.center.map((c, index) => (
                          <span
                            key={c.id}
                            style={{ '--card-index': index } as CSSProperties}
                          >
                            <OdinCardFace card={c} />
                          </span>
                        ))}
                      </div>
                      <div className="odin-center__value">
                        <strong>
                          {odinValue(state.center).toLocaleString('pt-BR', {
                            useGrouping: false,
                          })}
                        </strong>
                        <span>
                          {state.center.length}{' '}
                          {state.center.length === 1 ? 'carta' : 'cartas'} · por{' '}
                          {name(state.lastPlayer)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="odin-empty">
                      <span>✦</span>
                      <strong>Nova disputa</strong>
                      <small>
                        Abra com uma carta
                        <br />
                        ou com toda a sua mão combinada.
                      </small>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="odin-hand">
            <div className="odin-hand__toolbar">
              <span>
                <strong>
                  {!me || me.away ? 'Você está assistindo' : 'Sua mão'}
                </strong>
                {Boolean(hand.length) && (
                  <small>{hand.length} cartas · só você vê</small>
                )}
              </span>
              <div>
                <button
                  aria-label="Como jogar ODIN"
                  className="game-icon-button"
                  onClick={() => setModal('rules')}
                  type="button"
                >
                  ?
                </button>
                <button
                  aria-label={`Ordenar por ${sort === 'clan' ? 'número' : 'cor'}`}
                  className="game-action game-action--quiet"
                  onClick={() => setSort(sort === 'clan' ? 'number' : 'clan')}
                  type="button"
                >
                  {sort === 'clan' ? 'Por cor' : 'Por número'}{' '}
                  <Icon name="controls" />
                </button>
                <button
                  aria-label="Encerrar partida de ODIN"
                  className="game-icon-button"
                  onClick={() => setModal('end')}
                  title="Encerrar partida"
                  type="button"
                >
                  <Icon name="x" />
                </button>
              </div>
            </div>
            <div
              aria-label="Suas cartas"
              className="odin-hand__rail"
              style={
                {
                  '--hand-count': Math.max(1, sortedHand.length),
                } as CSSProperties
              }
            >
              {sortedHand.map((c, index) => (
                <button
                  aria-label={`${cardLabel(c)}${selected.includes(c.id) ? ', selecionada' : ''}`}
                  aria-pressed={selected.includes(c.id)}
                  className={`odin-hand-card ${selected.includes(c.id) ? 'is-selected' : ''} ${state.lastPlay?.actor === localId && state.lastPlay.taken?.id === c.id ? 'is-captured' : ''}`}
                  disabled={results || waiting}
                  key={c.id}
                  data-odin-card={c.id}
                  onClick={() =>
                    setSelection({
                      step: state.stepId,
                      ids: selected.includes(c.id)
                        ? selected.filter((id) => id !== c.id)
                        : [...selected, c.id],
                    })
                  }
                  style={{ '--card-index': index } as CSSProperties}
                  type="button"
                >
                  <OdinCardFace card={c} />
                </button>
              ))}
              {!hand.length && (
                <p>
                  {me && !me.away
                    ? results
                      ? 'Mão encerrada.'
                      : 'Recebendo suas cartas…'
                    : 'Acompanhe a mesa. Para jogar, abra a lista de jogadores.'}
                </p>
              )}
            </div>
            <div className="odin-hand__controls">
              <div className="odin-combination" aria-live="polite">
                {selected.length ? (
                  <>
                    <strong>{odinValue(selectedCards)}</strong>
                    <span>
                      {selectionError ||
                        (selected.length === hand.length
                          ? 'Esvazia sua mão'
                          : `${selected.length} selecionada${selected.length > 1 ? 's' : ''}`)}
                    </span>
                  </>
                ) : (
                  <span>
                    {myTurn
                      ? state.center.length
                        ? `Supere ${odinValue(state.center)} com ${state.center.length} ou ${state.center.length + 1} cartas`
                        : 'Escolha uma carta para abrir'
                      : finished
                        ? 'Menos pontos vence.'
                        : me && !me.away
                          ? 'Prepare sua próxima jogada'
                          : 'Só assistindo'}
                  </span>
                )}
              </div>
              <button
                className="game-action"
                disabled={!myTurn || !state.center.length || waiting}
                onClick={() => {
                  game.clearError()
                  if (game.move({ type: 'pass' }))
                    setPending({
                      step: state.stepId,
                      revision: state.revision,
                    })
                }}
                type="button"
              >
                Passar
              </button>
              <button
                className="game-action game-action--primary"
                disabled={
                  !myTurn ||
                  !selected.length ||
                  Boolean(selectionError) ||
                  waiting
                }
                onClick={play}
                type="button"
              >
                {waiting ? 'Enviando…' : 'Jogar'}
                <Icon name="chevron" />
              </button>
            </div>
          </div>
        </>
      )}
      {choosingCapture && (
        <GameModal
          title="Qual carta você pega?"
          detail="Pegue uma carta da jogada anterior. As outras serão descartadas."
          onClose={() => setCapture(null)}
          className="odin-modal"
        >
          <div className="odin-capture-choices">
            {state.center.map((c) => (
              <button
                aria-label={`Pegar ${cardLabel(c)}`}
                key={c.id}
                onClick={() => send(choosingCapture.ids, c.id)}
                type="button"
              >
                <OdinCardFace card={c} />
                <span>{cardLabel(c)}</span>
              </button>
            ))}
          </div>
          <p className="game-modal__hint">
            Você joga{' '}
            {odinValue(hand.filter((c) => choosingCapture.ids.includes(c.id)))}.
            A carta escolhida vai para a sua mão.
          </p>
        </GameModal>
      )}
      {modal === 'score' && (
        <GameModal
          title="Placar"
          detail="Cada carta que sobra vale 1 ponto. O menor total vence."
          onClose={() => setModal(null)}
          className="odin-modal"
        >
          {state.players.length ? (
            <ol className="odin-scoreboard">
              {[...state.players]
                .sort((a, b) => a.score - b.score)
                .map((p) => (
                  <li key={p.identity}>
                    <span>
                      {p.name}
                      {p.away && <small>Só assistindo</small>}
                    </span>
                    <strong>
                      {p.score}
                      <small> pts</small>
                    </strong>
                    {state.result && (
                      <em>
                        +
                        {state.result.entries.find(
                          (e) => e.identity === p.identity,
                        )?.penalty || 0}
                      </em>
                    )}
                  </li>
                ))}
            </ol>
          ) : (
            <p>O placar aparece quando a partida começar.</p>
          )}
        </GameModal>
      )}
      {modal === 'settings' && (
        <GameModal
          title="Opções de ODIN"
          onClose={() => setModal(null)}
          className="odin-modal"
        >
          <label className="odin-setting">
            <span>
              Duração
              <small>A partida termina quando alguém atinge o limite.</small>
            </span>
            <select
              aria-label="Duração da partida"
              value={settings.singleHand ? 'single' : settings.pointLimit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  singleHand: e.target.value === 'single',
                  pointLimit:
                    e.target.value === 'single'
                      ? settings.pointLimit
                      : (Number(e.target.value) as OdinSettings['pointLimit']),
                })
              }
            >
              <option value="10">10 pontos · curta</option>
              <option value="15">15 pontos · padrão</option>
              <option value="20">20 pontos · longa</option>
              <option value="single">Uma mão</option>
            </select>
          </label>
          <label className="odin-setting">
            <span>
              Duelo com 4 clãs
              <small>
                Em 2 pessoas, retira Lua e Flor. Recomendado pelas regras.
              </small>
            </span>
            <input
              aria-label="Duelo com quatro clãs"
              type="checkbox"
              checked={settings.duelFourClans}
              onChange={(e) =>
                setSettings({ ...settings, duelFourClans: e.target.checked })
              }
            />
          </label>
          <label className="odin-setting">
            <span>
              Tempo por jogada
              <small>Opcional. Ao acabar, passa ou abre com uma carta.</small>
            </span>
            <select
              aria-label="Tempo por jogada"
              value={settings.turnSeconds}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  turnSeconds: Number(
                    e.target.value,
                  ) as OdinSettings['turnSeconds'],
                })
              }
            >
              {[0, 30, 60, 90].map((value) => (
                <option key={value} value={value}>
                  {value ? `${value} segundos` : 'Sem limite'}
                </option>
              ))}
            </select>
          </label>
          <div className="game-modal__actions">
            <button
              className="game-action game-action--primary"
              onClick={() => setModal(null)}
              type="button"
            >
              Pronto
            </button>
          </div>
        </GameModal>
      )}
      {modal === 'rules' && (
        <GameModal
          title="Como jogar ODIN"
          detail="Combine bem. Termine com poucas cartas e menos pontos."
          onClose={() => setModal(null)}
          className="odin-modal"
          wide
        >
          <div className="odin-rules-example">
            <OdinCardFace card={{ id: 'leaf-2', clan: 'leaf', value: 2 }} />
            <span>+</span>
            <OdinCardFace card={{ id: 'leaf-8', clan: 'leaf', value: 8 }} />
            <strong>= 82</strong>
          </div>
          <ol className="odin-rules">
            <li>
              Cada pessoa recebe <b>9 cartas</b>. As que sobrarem ficam fora da
              mão.
            </li>
            <li>
              Quem abre joga <b>uma carta</b>. A única exceção é jogar toda a
              própria mão se ela combinar.
            </li>
            <li>
              Para cobrir, jogue a mesma quantidade da mesa ou <b>uma a mais</b>
              . Suas cartas devem ter a mesma cor ou o mesmo número entre si.
              Elas não precisam seguir a cor da mesa.
            </li>
            <li>
              Os números formam o <b>maior número possível</b>, do maior para o
              menor: 2 + 8 = 82. A jogada precisa superar a mesa.
            </li>
            <li>
              Depois de cobrir, <b>pegue uma carta da jogada anterior</b>.
              Descarte as outras. Se você esvaziou a mão, vence a mão
              imediatamente e não pega carta.
            </li>
            <li>
              Pode passar e jogar de novo na sua próxima vez. Se todos os outros
              passarem em sequência, a mesa é limpa e quem jogou por último abre
              outra disputa.
            </li>
            <li>
              Cada carta que sobrou vale <b>1 ponto</b>. Novas mãos começam
              automaticamente. Ao atingir o limite, vence quem tiver o menor
              total; empates dividem a vitória.
            </li>
          </ol>
          <p className="game-modal__hint">
            ODIN por Gary Kim, Hope S. e Yohan Goh / Helvetiq. Adaptação não
            oficial com arte Kiwi original.{' '}
            <a
              href="https://helvetiq.com/media/hexaattachment/products/attachments/Odin_Rules_EN_DE_FR_ES_IT_NL_compressed.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Regras oficiais
            </a>{' '}
            ·{' '}
            <a
              href="https://helvetiq.com/media/hexaattachment/products/attachments/ODIN_FAQ_EN.pdf"
              target="_blank"
              rel="noreferrer"
            >
              FAQ
            </a>
            .
          </p>
        </GameModal>
      )}
      {modal === 'end' && (
        <GameModal
          title="Encerrar ODIN?"
          detail="Encerra esta partida para todos. A call continua."
          onClose={() => setModal(null)}
          className="odin-modal"
        >
          <div className="game-modal__actions">
            <button
              className="game-action"
              onClick={() => setModal(null)}
              type="button"
            >
              Continuar jogando
            </button>
            <button
              className="game-action game-action--danger"
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
