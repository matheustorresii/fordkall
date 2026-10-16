import { useEffect, useState, type CSSProperties } from 'react'
import type { ParticipantMedia } from '../../types'
import type { useRoomCodenames } from '../../hooks/useRoomCodenames'
import {
  codenamesCurrentClue,
  codenamesClueLimit,
  codenamesGuessesLeft,
  codenamesPauseReason,
  codenamesStartError,
  codenamesTeamName,
  defaultCodenamesSettings,
  readCodenamesClue,
  readCodenamesSettings,
} from '../../games/codenames'
import type { CodenamesClueMode, CodenamesKind, CodenamesPlayer, CodenamesSettings, CodenamesTeam } from '../../games/codenames'
import { GameError, GameHud, GameModal } from './GameTable'
import { Icon } from '../ui/Icon'
import './CodenamesStage.css'
import { useGameMotion } from './useGameMotion'

type Game = Pick<
  ReturnType<typeof useRoomCodenames>,
  'state' | 'key' | 'error' | 'clearError' | 'start' | 'move' | 'reset'
>
interface Props {
  game: Game
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}
const kindName: Record<CodenamesKind, string> = {
  red: 'Agente vermelho',
  blue: 'Agente azul',
  neutral: 'Civil',
  assassin: 'Assassino',
}
const kindMark: Record<CodenamesKind, string> = { red: 'V', blue: 'A', neutral: '—', assassin: '×' }
const AgentAvatar = ({
  player,
  participants,
}: {
  player: CodenamesPlayer
  participants: ParticipantMedia[]
}) => {
  const photo = participants.find((p) => p.id === player.identity)?.avatarDataUrl
  return (
    <span className={`cn-avatar ${!player.connected ? 'is-away' : ''}`}>
      {photo ? (
        <img alt="" src={photo} />
      ) : (
        <span>{player.name.trim().slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
      )}
      {player.role === 'spymaster' && <b title="Mestre">M</b>}
    </span>
  )
}

export const CodenamesStage = ({ game, participants, onExit, onOpenGameHub }: Props) => {
  const { state } = game,
    lobby = state.phase === 'lobby',
    finished = state.phase === 'finished'
  const identity = participants.find((p) => p.isLocal)?.id ?? ''
  const motionRef = useGameMotion(`${state.phase}:${state.board.length}`, state.gameId)
  const local = state.players.find((p) => p.identity === identity)
  const [modal, setModal] = useState<'rules' | 'settings' | 'history' | 'teams' | 'reset' | null>(null)
  const [confirm, setConfirm] = useState<{ cardId: string; stepId: string } | null>(null)
  const [word, setWord] = useState(''),
    [count, setCount] = useState('2')
  const [customText, setCustomText] = useState(''),
    [hideKey, setHideKey] = useState(false)
  const [savedSettings, setSavedSettings] = useState<CodenamesSettings>({ ...defaultCodenamesSettings, clueMode: state.clueMode })
  const [draftClueMode, setDraftClueMode] = useState<CodenamesClueMode>(state.clueMode)
  const [pendingStep, setPendingStep] = useState('')
  const clue = codenamesCurrentClue(state),
    guessesLeft = codenamesGuessesLeft(state)
  const paused = codenamesPauseReason(state),
    startError = codenamesStartError(state)
  const isMaster = Boolean(local?.team && local.role === 'spymaster')
  const key = finished ? state.solution : isMaster && !hideKey ? game.key : []
  const busy = pendingStep === state.stepId && Boolean(pendingStep) && !game.error
  const myTurn = local?.team === state.turnTeam && local?.connected && !paused && !busy
  const mayGiveClue = myTurn && isMaster && state.phase === 'clue' && game.key.length === 25
  const mayGuess = myTurn && !isMaster && state.phase === 'guess'
  const suggested = state.board.find((c) => c.id === state.suggestions[identity] && !c.revealed)
  const confirming =
    confirm && confirm.stepId === state.stepId && mayGuess
      ? state.board.find((c) => c.id === confirm.cardId && !c.revealed)
      : null
  const customWords = customText
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const settings = readCodenamesSettings({ customWords, clueMode: draftClueMode }),
    settingsError = !settings
  const clueMode = lobby ? savedSettings.clueMode : state.clueMode
  const validClue = readCodenamesClue(word, state.clueMode)
  const roleLabel = !local?.team ? 'Assistindo' : isMaster ? 'Mestre' : 'Agente'
  useEffect(() => {
    setWord('')
    setPendingStep('')
    setConfirm(null)
  }, [state.gameId, state.turn, state.stepId])
  useEffect(() => {
    setHideKey(false)
  }, [state.gameId])
  useEffect(() => {
    setSavedSettings((saved) => ({ ...saved, clueMode: state.clueMode }))
  }, [state.clueMode])
  const sendClue = () => {
    if (
      mayGiveClue && validClue &&
      game.move({ type: 'clue', word, count: count === 'unlimited' ? count : Number(count) })
    )
      setPendingStep(state.stepId)
  }
  const teamPanel = (team: CodenamesTeam, compact = false) => {
    const members = state.players.filter((p) => p.team === team)
    const master = members.find((p) => p.role === 'spymaster')
    return (
      <section
        className={`cn-team cn-team--${team} ${!lobby && state.turnTeam === team && !finished ? 'is-turn' : ''} ${compact ? 'cn-team--full' : ''}`}
        aria-label={`Equipe ${codenamesTeamName(team)}`}
      >
        <button
          className="cn-team__score"
          onClick={() => !lobby && setModal('teams')}
          type="button"
          disabled={lobby}
        >
          <span>
            <i aria-hidden="true" />
            <strong>{codenamesTeamName(team)}</strong>
            <small>{lobby ? `${members.length} na equipe` : 'agentes restantes'}</small>
          </span>
          {!lobby && <b>{state.remaining[team]}</b>}
        </button>
        <div className="cn-team__roster">
          {[...members]
            .sort((a, b) => Number(b.role === 'spymaster') - Number(a.role === 'spymaster'))
            .map((p) => (
              <div
                className={`cn-player ${p.identity === identity ? 'is-you' : ''} ${!p.connected ? 'is-away' : ''}`}
                key={p.identity}
              >
                <AgentAvatar player={p} participants={participants} />
                <span>
                  <strong title={p.name}>{p.name}</strong>
                  <small>
                    {!p.connected ? 'Reconectando…' : p.role === 'spymaster' ? 'Mestre' : 'Agente'}
                    {p.identity === identity ? ' · você' : ''}
                  </small>
                </span>
              </div>
            ))}
          {!members.length && <p className="cn-team__empty">Ninguém por aqui ainda.</p>}
        </div>
        {lobby && (
          <div className="cn-team__join">
            <button
              className={local?.team === team && !isMaster ? 'is-selected' : ''}
              disabled={local?.team === team && !isMaster}
              onClick={() => game.move({ type: 'seat', team, role: 'operative' })}
              type="button"
            >
              {local?.team === team && !isMaster ? 'Você é agente' : 'Entrar como agente'}
            </button>
            <button
              className={local?.team === team && isMaster ? 'is-selected' : ''}
              disabled={Boolean(master)}
              onClick={() => game.move({ type: 'seat', team, role: 'spymaster' })}
              type="button"
            >
              {master?.identity === identity ? 'Você é mestre' : master ? 'Mestre escolhido' : 'Ser mestre'}
            </button>
          </div>
        )}
      </section>
    )
  }
  return (
    <section
      className={`codenames-stage ${lobby ? 'codenames-stage--lobby' : ''}`}
      lang="pt-BR"
      aria-label="Codenames"
      data-team={state.turnTeam}
      ref={motionRef}
    >
      <GameHud
        title="Codenames"
        subtitle={lobby ? '4–12 jogadores · PT-BR' : `Rodada ${state.turn}`}
        onExit={onExit}
        onOpenGameHub={onOpenGameHub}
      >
        <button
          className="game-icon-button"
          type="button"
          onClick={() => setModal('rules')}
          aria-label="Regras de Codenames"
        >
          ?
        </button>
      </GameHud>
      <GameError error={game.error} onClose={game.clearError} />
      {lobby ? (
        <div className="cn-lobby">
          <div className="cn-lobby__heading">
            <div>
              <span>DUAS EQUIPES. UMA MESA.</span>
              <h1>Codenames</h1>
              <p>Encontre as palavras da sua equipe. Evite o assassino.</p>
              <button type="button" onClick={() => setModal('rules')}>
                Como jogar ↗
              </button>
            </div>
            <div className="cn-lobby__illustration" aria-hidden="true">
              {['ÓRBITA', 'COROA', 'PONTE', 'CÓDIGO', 'NOITE', 'CHAVE', 'BANCO', 'LUA', 'FOLHA'].map(
                (word, i) => (
                  <i key={word} data-color={i % 4 === 0 ? 'red' : i % 3 === 0 ? 'blue' : 'neutral'}>
                    {word}
                  </i>
                ),
              )}
            </div>
          </div>
          <div className="cn-lobby__teams">
            {teamPanel('red')}
            {teamPanel('blue')}
          </div>
          <div className="cn-lobby__bench">
            <span>Sem equipe</span>
            <div>
              {state.players
                .filter((p) => !p.team)
                .map((p) => (
                  <span className="cn-bench-player" title={p.name} key={p.identity}>
                    <AgentAvatar player={p} participants={participants} />
                    <span>
                      {p.name}
                      {p.identity === identity ? ' (você)' : ''}
                    </span>
                  </span>
                ))}
            </div>
            {local?.team && (
              <button
                onClick={() => game.move({ type: 'seat', team: null, role: 'operative' })}
                type="button"
              >
                Prefiro assistir
              </button>
            )}
          </div>
          <footer className="cn-lobby__actions">
            <div>
              <strong>Um mestre e pelo menos um agente por equipe.</strong>
              <span>{startError || `Equipes prontas · pistas ${savedSettings.clueMode === 'single' ? 'de uma palavra' : 'com várias palavras'}.`}</span>
            </div>
            <div>
              <button
                className="cn-button"
                onClick={() => {
                  setCustomText(savedSettings.customWords.join('\n'))
                  setDraftClueMode(savedSettings.clueMode)
                  setModal('settings')
                }}
                type="button"
              >
                <Icon name="controls" />
                <span>Configurações</span>
              </button>
              <button
                className="cn-button"
                disabled={state.players.length < 4 || state.players.length > 12}
                onClick={() => game.move({ type: 'shuffle' })}
                type="button"
              >
                Sortear equipes
              </button>
              <button
                className="cn-button cn-button--primary"
                disabled={Boolean(startError)}
                onClick={() => game.start(savedSettings)}
                type="button"
              >
                Começar <Icon name="play" />
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <>
          <div className="cn-play">
            {teamPanel('red')}
            <div className="cn-table">
              <div className="cn-table__status">
                <span className="cn-turn-label">
                  {finished
                    ? `Equipe ${codenamesTeamName(state.winner!)} venceu`
                    : paused
                      ? 'Partida pausada'
                      : `${state.phase === 'clue' ? 'Pista' : 'Palpites'} da equipe ${codenamesTeamName(state.turnTeam)}`}
                </span>
                <div>
                  {isMaster && !finished && (
                    <button
                      className={`cn-key-toggle ${!hideKey ? 'is-active' : ''}`}
                      aria-pressed={!hideKey}
                      onClick={() => setHideKey(!hideKey)}
                      type="button"
                    >
                      {hideKey ? 'Mostrar chave' : 'Chave do mestre'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setModal('rules')}
                    title="Como jogar"
                    aria-label="Como jogar Codenames"
                  >
                    ?
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal('history')}
                    title="Pistas e jogadas"
                    aria-label="Pistas e jogadas"
                  >
                    <Icon name="chat" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal('reset')}
                    title="Opções da partida"
                    aria-label="Opções da partida"
                  >
                    <Icon name="menu" />
                  </button>
                </div>
              </div>
              <div className="cn-board" aria-label="Mesa com 25 palavras">
                {state.board.map((card, index) => {
                  const visibleKind = card.revealed || key[index] || null
                  const choices = Object.entries(state.suggestions).filter(
                    ([, selected]) => selected === card.id,
                  )
                  const mine = state.suggestions[identity] === card.id
                  return (
                    <button
                      className={`cn-tile ${card.revealed ? 'is-revealed' : ''} ${mine ? 'is-suggested' : ''} ${card.word.length > 10 ? 'cn-tile--long' : ''}`}
                      style={{ '--cn-letters': card.word.length } as CSSProperties}
                      data-kind={visibleKind ?? 'unknown'}
                      data-card-id={card.id}
                      data-game-card={card.id}
                      aria-label={`${card.word}${visibleKind ? `, ${kindName[visibleKind]}` : ''}${card.revealed ? ', revelada' : ''}${mine ? ', seu palpite' : ''}${choices.length ? `, ${choices.length} ${choices.length === 1 ? 'sugestão' : 'sugestões'}` : ''}`}
                      aria-pressed={mine}
                      disabled={!mayGuess || Boolean(card.revealed)}
                      key={`${state.gameId}-${card.id}`}
                      onClick={() => game.move({ type: 'suggest', cardId: mine ? null : card.id })}
                      type="button"
                    >
                      <span className="cn-tile__index" aria-hidden="true">
                        {visibleKind ? kindMark[visibleKind] : String(index + 1).padStart(2, '0')}
                      </span>
                      {card.revealed && (
                        <span className="cn-tile__revealed" aria-hidden="true">
                          ✓
                        </span>
                      )}
                      <strong>{card.word}</strong>
                      {visibleKind && <small aria-hidden="true">{kindName[visibleKind]}</small>}
                      {choices.length > 0 && (
                        <span className="cn-tile__votes" aria-hidden="true">
                          {choices.slice(0, 3).map(([id]) => {
                            const p = state.players.find((person) => person.identity === id)!
                            return <AgentAvatar key={id} player={p} participants={participants} />
                          })}
                          {choices.length > 3 && <b>+{choices.length - 3}</b>}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            {teamPanel('blue')}
          </div>
          <footer className="cn-console">
            <div className="cn-console__identity">
              <span className={`cn-role-badge ${isMaster ? 'is-master' : ''}`} aria-hidden="true">
                {isMaster ? 'M' : local?.team ? 'A' : '·'}
              </span>
              <span>
                <strong>
                  {roleLabel}
                  {local?.team ? ` · ${codenamesTeamName(local.team)}` : ''}
                </strong>
                <small>
                  {isMaster
                    ? 'A chave é secreta. Não dê outras dicas.'
                    : local?.team
                      ? 'Conversem antes de confirmar.'
                      : 'Entre na próxima partida para jogar.'}
                </small>
              </span>
            </div>
            {finished ? (
              <div className="cn-result">
                <span>
                  <strong>{codenamesTeamName(state.winner!)} venceu!</strong>
                  <small>
                    {state.finishReason === 'assassin'
                      ? 'O assassino foi revelado.'
                      : 'Todos os agentes foram encontrados.'}
                  </small>
                </span>
                <button
                  className="cn-button cn-button--primary"
                  type="button"
                  onClick={() => game.start(savedSettings)}
                >
                  Jogar de novo
                </button>
                <button className="cn-button" type="button" onClick={() => game.reset()}>
                  Trocar equipes
                </button>
              </div>
            ) : paused ? (
              <p className="cn-wait" role="status">
                {paused}
              </p>
            ) : state.phase === 'clue' ? (
              <>
                {mayGiveClue ? (
                  <form
                    className="cn-clue-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      sendClue()
                    }}
                  >
                    <label>
                      <span>{state.clueMode === 'single' ? 'Sua pista · uma palavra' : 'Sua pista · várias palavras'}</span>
                      <input
                        aria-label="Texto da pista"
                        autoComplete="off"
                        autoCorrect="off"
                        maxLength={codenamesClueLimit(state.clueMode)}
                        onChange={(e) => setWord(e.target.value)}
                        placeholder={state.clueMode === 'single' ? 'Uma palavra…' : 'Uma palavra ou frase curta…'}
                        spellCheck={false}
                        value={word}
                      />
                    </label>
                    <label>
                      <span>Cartas</span>
                      <select
                        aria-label="Número de cartas relacionadas à pista"
                        onChange={(e) => setCount(e.target.value)}
                        value={count}
                      >
                        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                          <option value={n} key={n}>
                            {n}
                          </option>
                        ))}
                        <option value="0">0</option>
                        <option value="unlimited">∞</option>
                      </select>
                    </label>
                    <button
                      className="cn-button cn-button--primary"
                      disabled={!validClue || busy}
                      type="submit"
                    >
                      Enviar pista <Icon name="chevron" />
                    </button>
                  </form>
                ) : (
                  <p className="cn-wait" role="status">
                    {isMaster && local?.team === state.turnTeam && game.key.length !== 25
                      ? 'Sincronizando sua chave secreta…'
                      : `O mestre da equipe ${codenamesTeamName(state.turnTeam)} está pensando na pista.`}
                  </p>
                )}
              </>
            ) : (
              <div className="cn-guess-controls">
                <div className="cn-clue-chip">
                  <small>PISTA</small>
                  <strong title={clue?.word}>{clue?.word}</strong>
                  <b>{clue?.count === 'unlimited' ? '∞' : clue?.count}</b>
                </div>
                <span className="cn-attempts">
                  {guessesLeft === null
                    ? 'Palpites ilimitados'
                    : `${guessesLeft} palpite${guessesLeft === 1 ? '' : 's'} restante${guessesLeft === 1 ? '' : 's'}`}
                </span>
                {mayGuess ? (
                  <div className="cn-guess-actions">
                    <button
                      className="cn-button cn-button--primary"
                      disabled={!suggested || busy}
                      onClick={() => suggested && setConfirm({ cardId: suggested.id, stepId: state.stepId })}
                      type="button"
                    >
                      {suggested ? `Revelar ${suggested.word}` : 'Escolha uma palavra'}
                    </button>
                    <button
                      className="cn-button cn-pass"
                      disabled={!clue?.guesses.length || busy}
                      onClick={() => {
                        if (game.move({ type: 'pass' })) setPendingStep(state.stepId)
                      }}
                      type="button"
                    >
                      Encerrar turno
                    </button>
                  </div>
                ) : (
                  <span className="cn-watching">
                    {isMaster ? 'Deixe os agentes decidirem.' : 'Aguarde a outra equipe.'}
                  </span>
                )}
              </div>
            )}
          </footer>
          <p className="cn-last-event" aria-live="polite" aria-atomic="true">
            {state.events.at(-1)?.text}
          </p>
        </>
      )}
      {confirming && (
        <GameModal
          className="cn-modal"
          title={`Revelar ${confirming.word}?`}
          detail="Essa escolha vale para toda a equipe e não pode ser desfeita."
          onClose={() => setConfirm(null)}
        >
          <div className="cn-confirm-word">{confirming.word}</div>
          <div className="game-modal__actions">
            <button className="cn-button" onClick={() => setConfirm(null)} type="button">
              Continuar pensando
            </button>
            <button
              className="cn-button cn-button--primary"
              onClick={() => {
                if (game.move({ type: 'guess', cardId: confirming.id })) {
                  setPendingStep(state.stepId)
                  setConfirm(null)
                }
              }}
              type="button"
            >
              Confirmar palavra
            </button>
          </div>
        </GameModal>
      )}
      {modal && (
        <GameModal
          className="cn-modal"
          wide={modal === 'teams'}
          title={
            {
              rules: 'Como jogar',
              settings: 'Configurações do Codenames',
              history: 'Pistas e jogadas',
              teams: 'As equipes',
              reset: 'Opções da partida',
            }[modal]
          }
          onClose={() => setModal(null)}
        >
          {modal === 'rules' ? (
            <div className="cn-rules">
              <p>
                São duas equipes, cada uma com um <strong>mestre</strong> e um ou mais{' '}
                <strong>agentes</strong>. Só os mestres veem a identidade das 25 palavras.
              </p>
              <p>
                Na sua vez, o mestre envia <strong>{clueMode === 'single' ? 'uma palavra' : 'uma palavra ou frase curta'} e um número</strong>. O número indica quantas
                palavras ele relacionou à pista. Não use palavras ainda visíveis na mesa como pista.
              </p>
              <p>O formato da pista é escolhido antes da partida e vale para as duas equipes. No modo com várias palavras, a pista pode ter até 48 caracteres, com até 24 por palavra.</p>
              <p>
                Os agentes marcam sugestões, conversam e confirmam uma palavra por vez. Acertar permite
                continuar; encontrar um civil ou um agente rival encerra o turno. Uma carta rival também ajuda
                a outra equipe.
              </p>
              <p>
                É preciso tentar ao menos uma vez. Depois, a equipe pode encerrar ou arriscar até{' '}
                <strong>o número da pista + 1</strong>, aproveitando pistas anteriores.
              </p>
              <p>
                <strong>0 e ∞</strong> permitem palpites sem limite. Com zero, a pista indica algo para
                evitar. O assassino faz sua equipe perder imediatamente.
              </p>
              <p>
                Vence a equipe que encontrar todos os seus agentes. Quem começa tem nove; a outra equipe,
                oito. Marcar sugestões não revela cartas e não exige votação unânime.
              </p>
              <a href="https://www.czechgames.com/games/codenames" target="_blank" rel="noreferrer">
                Jogo original de Vlaada Chvátil · Czech Games Edition ↗
              </a>
            </div>
          ) : modal === 'settings' ? (
            <div className="cn-settings">
              <fieldset className="cn-clue-setting">
                <legend>Palavras na pista</legend>
                <label>
                  <input type="radio" name="cn-clue-mode" value="single" checked={draftClueMode === 'single'} onChange={() => setDraftClueMode('single')} />
                  <span><strong>Uma palavra</strong><small>Ex.: Órbita · até 24 caracteres</small></span>
                </label>
                <label>
                  <input type="radio" name="cn-clue-mode" value="multiple" checked={draftClueMode === 'multiple'} onChange={() => setDraftClueMode('multiple')} />
                  <span><strong>Várias palavras</strong><small>Ex.: Sistema solar · até 48 caracteres</small></span>
                </label>
              </fieldset>
              <p>A regra escolhida vale para as duas equipes nesta partida.</p>
              <details className="cn-custom-words">
                <summary>Banco de palavras <span>{customWords.length ? `· ${customWords.length} personalizadas` : '· padrão'}</span></summary>
              <p>
                {customText.trim()
                  ? 'Seu banco substitui o padrão nesta partida.'
                  : 'Banco próprio com palavras em português. Sem baixar nada ou usar IA durante o jogo.'}
              </p>
              <label>
                Palavras personalizadas <span>opcional</span>
                <textarea
                  aria-label="Palavras personalizadas"
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder={
                    'Uma palavra por linha ou separada por vírgula.\nMínimo de 25 palavras diferentes.'
                  }
                  value={customText}
                  rows={7}
                  maxLength={8000}
                />
              </label>
              <small className={settingsError ? 'is-error' : ''}>
                {settingsError
                  ? 'Use de 25 a 300 palavras diferentes, sem espaços, com até 24 caracteres cada.'
                  : customWords.length
                    ? `${settings!.customWords.length} palavras prontas para sortear.`
                    : 'O banco padrão será usado.'}
              </small>
              </details>
              <div className="game-modal__actions">
                <button className="cn-button" type="button" onClick={() => setCustomText('')}>
                  Usar banco padrão
                </button>
                <button
                  className="cn-button cn-button--primary"
                  disabled={settingsError}
                  onClick={() => {
                    setSavedSettings(settings!)
                    setModal(null)
                  }}
                  type="button"
                >
                  Pronto
                </button>
              </div>
            </div>
          ) : modal === 'teams' ? (
            <div className="cn-modal-teams">
              {teamPanel('red', true)}
              {teamPanel('blue', true)}
            </div>
          ) : modal === 'history' ? (
            <div className="cn-history">
              {!state.clues.length && <p>A primeira pista ainda não foi dada.</p>}
              {[...state.clues].reverse().map((c) => (
                <section key={c.turn} data-team={c.team}>
                  <header>
                    <span>
                      Rodada {c.turn} · {codenamesTeamName(c.team)}
                    </span>
                    <strong>
                      {c.word} <b>{c.count === 'unlimited' ? '∞' : c.count}</b>
                    </strong>
                    <small>{state.players.find((p) => p.identity === c.by)?.name}</small>
                  </header>
                  <div>
                    {c.guesses.length ? (
                      c.guesses.map((g) => (
                        <span key={g.cardId} data-kind={g.kind}>
                          {state.board.find((card) => card.id === g.cardId)?.word}
                          <small>{kindName[g.kind]}</small>
                        </span>
                      ))
                    ) : (
                      <small>Aguardando palpites.</small>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="cn-rules">
              <p>Voltar para a seleção de equipes encerra a partida para todos e descarta a chave atual.</p>
              <div className="game-modal__actions">
                <button className="cn-button" type="button" onClick={() => setModal(null)}>
                  Continuar jogando
                </button>
                <button
                  className="cn-button cn-button--danger"
                  type="button"
                  onClick={() => {
                    if (game.reset()) setModal(null)
                  }}
                >
                  Encerrar partida
                </button>
              </div>
            </div>
          )}
        </GameModal>
      )}
    </section>
  )
}
