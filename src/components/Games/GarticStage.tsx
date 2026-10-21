import { useEffect, useState } from 'react'
import { defaultGarticSettings, type GarticState } from '../../games/partyGames'
import type { PartyGameController } from '../../hooks/useRoomPartyGame'
import type { RoomSketch } from '../../hooks/useRoomSketch'
import type { ParticipantMedia } from '../../types'
import { GameError, GameHud } from './GameTable'
import { SketchCanvas, SketchThumbnail } from './SketchCanvas'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { Icon } from '../ui/Icon'
import './PartyGames.css'
export const GarticStage = ({
  sketch,
  game,
  participants,
  onExit,
  onOpenGameHub,
}: {
  sketch: RoomSketch
  game: PartyGameController
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}) => {
  const s = game.state as GarticState,
    [settings, setSettings] = useState(defaultGarticSettings),
    [guess, setGuess] = useState(''),
    [finishError, setFinishError] = useState(''),
    [finishing, setFinishing] = useState(false),
    [now, setNow] = useState(Date.now())
  const { archive } = sketch
  const actor = s.actor === game.identity,
    telephone = s.settings.mode === 'telephone',
    player = s.players.some((p) => p.identity === game.identity),
    seconds = Math.max(0, Math.ceil((s.deadline - now) / 1000))
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    setGuess('')
    setFinishError('')
    setFinishing(false)
  }, [s.stepId])
  const finish = async () => {
    if (finishing) return
    setFinishing(true)
    try {
      await sketch.session.flushNow()
      game.move({ type: 'finish-drawing' })
    } catch (error) {
      setFinishError(
        error instanceof Error
          ? error.message
          : 'O desenho não foi enviado. Tente novamente.',
      )
    } finally {
      setFinishing(false)
    }
  }
  const submit = () => {
    if (guess.trim() && game.move({ type: 'guess', text: guess })) setGuess('')
  }
  return (
    <section className="party-stage gartic-stage">
      <GameHud
        title="Gartic Kiwi"
        subtitle={
          s.gameId
            ? telephone
              ? 'Telefone sem fio'
              : s.settings.mode === 'teams'
                ? 'Equipes'
                : 'Clássico'
            : 'Desenha aí.'
        }
        onExit={onExit}
        onOpenGameHub={onOpenGameHub}
      />
      <GameError
        error={finishError || game.error}
        onClose={() => {
          setFinishError('')
          game.clearError()
        }}
      />
      {!s.gameId ? (
        <div className="party-lobby gartic-lobby">
          <div className="gartic-emblem">
            <Icon name="edit" />
          </div>
          <span className="party-eyebrow">A MELHOR PIOR ARTE DA SALA</span>
          <h1>
            Rabisca.
            <br />A galera adivinha.
          </h1>
          <p>Um canvas, alguns palpites e zero talento obrigatório.</p>
          <div className="party-setup">
            <label>
              Modo
              <select
                value={settings.mode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    mode: e.target.value as typeof settings.mode,
                  })
                }
              >
                <option value="classic">Clássico · desenhar e adivinhar</option>
                <option value="teams">Equipes · placar por time</option>
                <option value="telephone">
                  Telefone sem fio · desenhar e descrever
                </option>
              </select>
            </label>
            <div className="party-setup__row">
              <label>
                Tempo
                <select
                  value={settings.seconds}
                  onChange={(e) =>
                    setSettings({ ...settings, seconds: +e.target.value })
                  }
                >
                  {[30, 60, 90, 120, 180].map((n) => (
                    <option value={n} key={n}>
                      {n} segundos
                    </option>
                  ))}
                </select>
              </label>
              {settings.mode !== 'telephone' && (
                <label>
                  Voltas
                  <select
                    value={settings.rounds}
                    onChange={(e) =>
                      setSettings({ ...settings, rounds: +e.target.value })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <details>
              <summary>Palavras da sua galera</summary>
              <textarea
                aria-label="Palavras personalizadas"
                maxLength={2000}
                value={settings.customWords}
                onChange={(e) =>
                  setSettings({ ...settings, customWords: e.target.value })
                }
                placeholder="Uma palavra por linha ou separada por vírgula"
              />
              <small>
                Em branco: sorteio do catálogo. Telefone sem fio começa com uma
                frase de vocês.
              </small>
            </details>
            <button
              className="game-action game-action--primary"
              disabled={
                game.participantCount < (settings.mode === 'telephone' ? 3 : 2)
              }
              onClick={() => game.start(settings)}
            >
              Começar · {game.participantCount} pessoas
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="gartic-roundbar">
            <div>
              <span className="party-eyebrow">
                {s.phase === 'finished' ? 'RESULTADO' : `TURNO ${s.turn + 1}`}
              </span>
              <strong>
                {s.phase === 'finished'
                  ? 'Olha no que deu.'
                  : s.phase === 'roundEnd'
                    ? `Era ${s.reveal}.`
                    : s.phase === 'choosing'
                      ? `${s.players.find((p) => p.identity === s.actor)?.name} escolhe a palavra`
                      : s.phase === 'prompt'
                        ? 'Comece uma história'
                        : s.phase === 'guessing'
                          ? 'Descreva o desenho'
                          : `${s.players.find((p) => p.identity === s.actor)?.name} está desenhando`}
              </strong>
            </div>
            {s.deadline > 0 && s.phase !== 'finished' && (
              <span className={`gartic-timer ${seconds < 15 ? 'is-low' : ''}`}>
                <Icon name="refresh" />
                {seconds}s
              </span>
            )}
          </div>
          <div className="gartic-body">
            <div className="gartic-main">
              {s.boardId && s.phase !== 'finished' && (
                <div
                  className={`gartic-drawing ${telephone && s.phase === 'drawing' && !actor ? 'is-concealed' : ''}`}
                >
                  <SketchCanvas
                    key={s.boardId}
                    session={sketch.session}
                    editable={actor && s.phase === 'drawing'}
                  />
                  {telephone && s.phase === 'drawing' && !actor && (
                    <div className="gartic-conceal">
                      <Icon name="eyeOff" />
                      <strong>Uma obra-prima está nascendo.</strong>
                      <span>O desenho aparece na próxima etapa.</span>
                    </div>
                  )}
                </div>
              )}
              {s.phase === 'choosing' && (
                <div className="gartic-choice-overlay">
                  <span className="party-eyebrow">
                    {actor ? 'SÓ VOCÊ VÊ ESTAS OPÇÕES' : 'JÁ VAI COMEÇAR'}
                  </span>
                  <h2>
                    {actor
                      ? 'O que você vai desenhar?'
                      : 'Escolhendo uma palavra…'}
                  </h2>
                  {actor && (
                    <div>
                      {game.secret.choices?.map((w) => (
                        <button
                          key={w}
                          onClick={() => game.move({ type: 'choose', word: w })}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {s.phase === 'prompt' && (
                <div className="gartic-choice-overlay">
                  <h2>
                    {actor
                      ? 'Escreva uma frase para a próxima pessoa desenhar.'
                      : 'Esperando a primeira ideia.'}
                  </h2>
                  {actor && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        submit()
                      }}
                    >
                      <input
                        maxLength={120}
                        aria-label="Frase inicial"
                        value={guess}
                        onChange={(e) => setGuess(e.target.value)}
                        placeholder="Um kiwi fugindo de um dinossauro…"
                      />
                      <button className="game-action" type="submit">
                        Enviar frase
                      </button>
                    </form>
                  )}
                </div>
              )}
              {s.phase === 'finished' &&
                (telephone ? (
                  <div className="gartic-album">
                    {s.resultAlbum.map((entry, i) => (
                      <article key={i}>
                        <header>
                          <b>{i + 1}</b>
                          <strong>
                            {s.players.find((p) => p.identity === entry.actor)
                              ?.name || 'Quem saiu'}
                          </strong>
                          <small>
                            {entry.kind === 'text' ? 'escreveu' : 'desenhou'}
                          </small>
                        </header>
                        {entry.kind === 'text' ? (
                          <p>“{entry.text}”</p>
                        ) : archive.current.has(entry.boardId) ? (
                          <SketchThumbnail
                            elements={archive.current.get(entry.boardId)!}
                          />
                        ) : (
                          <p>Você entrou depois deste desenho.</p>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="gartic-score-final">
                    <span className="party-eyebrow">PLACAR FINAL</span>
                    <h2>
                      {
                        [...s.players].sort((a, b) => b.score - a.score)[0]
                          ?.name
                      }{' '}
                      mandou bem.
                    </h2>
                    {s.settings.mode === 'teams' && (
                      <p>
                        Equipe Azul{' '}
                        {s.players
                          .filter((p) => p.team === 0)
                          .reduce((n, p) => n + p.score, 0)}{' '}
                        ×{' '}
                        {s.players
                          .filter((p) => p.team === 1)
                          .reduce((n, p) => n + p.score, 0)}{' '}
                        Equipe Coral
                      </p>
                    )}
                    <button
                      className="game-action"
                      onClick={() => game.start(settings)}
                    >
                      Jogar de novo
                    </button>
                  </div>
                ))}
              {actor && s.phase === 'drawing' && (
                <div className="gartic-secret">
                  <small>{telephone ? 'DESENHE A FRASE' : 'SUA PALAVRA'}</small>
                  <strong>{game.secret.word || 'Recebendo…'}</strong>
                  <button
                    type="button"
                    disabled={finishing}
                    onClick={() => void finish()}
                  >
                    {finishing ? 'Enviando…' : 'Terminei'} <Icon name="check" />
                  </button>
                </div>
              )}
              {!actor && !telephone && s.phase === 'drawing' && (
                <div className="gartic-word-hint">{s.wordShape}</div>
              )}
              {s.phase === 'roundEnd' && (
                <div className="gartic-round-result">
                  <span>PALAVRA DA RODADA</span>
                  <strong>{s.reveal}</strong>
                  <small>Próximo desenho em {seconds}s</small>
                  {(actor || game.isController) && (
                    <button onClick={() => game.move({ type: 'next' })}>
                      Continuar agora →
                    </button>
                  )}
                </div>
              )}
            </div>
            <aside className="gartic-sidebar">
              <div className="gartic-players">
                {[...s.players]
                  .sort((a, b) => b.score - a.score)
                  .map((p) => {
                    const media = participants.find((m) => m.id === p.identity)
                    return (
                      <div
                        key={p.identity}
                        className={`${p.identity === s.actor ? 'is-drawing' : ''} ${s.guessed.includes(p.identity) ? 'is-correct' : ''}`}
                      >
                        <ProfileAvatar
                          name={p.name}
                          avatarDataUrl={media?.avatarDataUrl}
                          appearance={media?.appearance}
                        />
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.identity === s.actor
                              ? 'Na vez'
                              : s.guessed.includes(p.identity)
                                ? 'Acertou!'
                                : s.settings.mode === 'teams'
                                  ? `Equipe ${p.team ? 'Coral' : 'Azul'}`
                                  : 'Jogador'}
                          </small>
                        </span>
                        {!telephone && <b>{p.score}</b>}
                      </div>
                    )
                  })}
              </div>
              {!telephone && (
                <div className="gartic-guesses" aria-live="polite">
                  {s.messages.map((m, i) => (
                    <p key={i} className={m.correct ? 'is-correct' : ''}>
                      <strong>{m.name}</strong> {m.text}
                    </p>
                  ))}
                </div>
              )}
              {player &&
                ((!actor &&
                  s.phase === 'drawing' &&
                  !s.guessed.includes(game.identity) &&
                  !telephone) ||
                  (actor && s.phase === 'guessing')) && (
                  <form
                    className="gartic-guess-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submit()
                    }}
                  >
                    <input
                      aria-label={
                        telephone ? 'Descreva o desenho' : 'Seu palpite'
                      }
                      placeholder={
                        telephone
                          ? 'O que tem no desenho?'
                          : 'Digite seu palpite…'
                      }
                      maxLength={120}
                      value={guess}
                      onChange={(e) => setGuess(e.target.value)}
                    />
                    <button type="submit" aria-label="Enviar palpite">
                      <Icon name="send" />
                    </button>
                  </form>
                )}
              {telephone && s.phase === 'finished' && (
                <button
                  className="game-action"
                  onClick={() => game.start(settings)}
                >
                  Nova história
                </button>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  )
}
