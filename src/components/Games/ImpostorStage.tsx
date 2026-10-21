import { useState } from 'react'
import {
  defaultImpostorSettings,
  majority,
  WORD_PAIRS,
  type ImpostorState,
} from '../../games/partyGames'
import type { PartyGameController } from '../../hooks/useRoomPartyGame'
import type { ParticipantMedia } from '../../types'
import { GameError, GameHud, GameModal } from './GameTable'
import { ProfileAvatar } from '../ui/ProfileAvatar'
import { Icon } from '../ui/Icon'
import './PartyGames.css'

export const ImpostorStage = ({
  game,
  participants,
  onExit,
  onOpenGameHub,
}: {
  game: PartyGameController
  participants: ParticipantMedia[]
  onExit: () => void
  onOpenGameHub: () => void
}) => {
  const s = game.state as ImpostorState
  const [settings, setSettings] = useState(defaultImpostorSettings),
    [shown, setShown] = useState(false),
    [confirm, setConfirm] = useState('')
  const player = s.players.some((p) => p.identity === game.identity),
    requested = s.requests.includes(game.identity)
  return (
    <section className="party-stage impostor-stage">
      <GameHud
        title="Impostor"
        subtitle={s.theme || 'Uma palavra. Uma pessoa fora do contexto.'}
        onExit={onExit}
        onOpenGameHub={onOpenGameHub}
      />
      <GameError error={game.error} onClose={game.clearError} />
      {!s.gameId ? (
        <div className="party-lobby">
          <div className="impostor-emblem">?</div>
          <span className="party-eyebrow">DESCUBRA QUEM NÃO SABE</span>
          <h1>
            Tem alguém
            <br />
            fora do contexto.
          </h1>
          <p>
            Deem pistas pela call. Todo mundo recebe uma palavra — menos uma
            pessoa.
          </p>
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
                <option value="related">Palavras parecidas</option>
                <option value="impostor">Impostor sem palavra</option>
              </select>
            </label>
            <label>
              Tema
              <select
                value={settings.theme}
                onChange={(e) =>
                  setSettings({ ...settings, theme: e.target.value })
                }
              >
                {Object.keys(WORD_PAIRS).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <details>
              <summary>Seus próprios pares de palavras</summary>
              <textarea
                aria-label="Pares personalizados"
                placeholder={'Homem de Ferro | Homem-Aranha\nPraia | Piscina'}
                value={settings.customPairs}
                onChange={(e) =>
                  setSettings({ ...settings, customPairs: e.target.value })
                }
                maxLength={2000}
              />
              <small>
                Um par por linha, separado por |. Deixe vazio para usar o tema.
              </small>
            </details>
            <button
              className="game-action game-action--primary"
              disabled={game.participantCount < 3}
              onClick={() => {
                setShown(false)
                game.start(settings)
              }}
            >
              Distribuir palavras · {game.participantCount} pessoas
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="impostor-heading">
            <span className="party-eyebrow">
              {s.phase === 'talk'
                ? 'RODADA DE PISTAS'
                : s.phase === 'vote'
                  ? 'HORA DA VERDADE'
                  : 'PALAVRAS REVELADAS'}
            </span>
            <h1>
              {s.phase === 'talk'
                ? 'Disfarça. E presta atenção.'
                : s.phase === 'vote'
                  ? 'Quem é o impostor?'
                  : s.result?.caught
                    ? 'Impostor encontrado.'
                    : s.result?.accused.length === 1
                      ? 'O impostor escapou.'
                      : 'A votação empatou.'}
            </h1>
            <p>
              {s.phase === 'talk'
                ? 'Conversem pela call. Quando a maioria estiver pronta, começa a votação.'
                : s.phase === 'vote'
                  ? 'O seu voto é secreto até todo mundo votar. Você pode alterá-lo.'
                  : s.result?.reason ||
                    'Todo mundo de volta ao mesmo contexto.'}
            </p>
          </div>
          <div className="impostor-arena">
            <div className="impostor-orbit" aria-hidden="true" />
            <div className="impostor-role-area">
              {s.phase !== 'result' ? (
                player ? (
                  <button
                    type="button"
                    className={`impostor-word ${shown ? 'is-revealed' : ''}`}
                    key={s.gameId}
                    onClick={() => setShown(!shown)}
                  >
                    <span>{shown ? 'SUA PALAVRA' : 'SÓ VOCÊ PODE VER'}</span>
                    <strong>
                      {shown
                        ? game.secret.word || 'Recebendo…'
                        : 'Toque para revelar'}
                    </strong>
                    <small>
                      <Icon name={shown ? 'eyeOff' : 'eye'} />
                      {shown
                        ? 'Toque para esconder'
                        : 'Não mostre sua tela para a sala'}
                    </small>
                  </button>
                ) : (
                  <div className="impostor-word">
                    <span>ESPECTADOR</span>
                    <strong>Descubra com a galera.</strong>
                    <small>Você não recebeu uma palavra nesta rodada.</small>
                  </div>
                )
              ) : (
                <div className="impostor-result">
                  <span>A palavra da sala</span>
                  <strong>{s.result?.word}</strong>
                  <span>Palavra do impostor</span>
                  <b>
                    {s.mode === 'impostor' ? 'IMPOSTOR' : s.result?.otherWord}
                  </b>
                  <p>
                    {s.players.find((p) => p.identity === s.result?.impostor)
                      ?.name || 'Quem saiu'}{' '}
                    era o impostor.
                  </p>
                  <button
                    className="game-action"
                    onClick={() => {
                      setShown(false)
                      game.start(settings)
                    }}
                  >
                    Nova rodada
                  </button>
                </div>
              )}
            </div>
            <div className="impostor-players">
              {s.players.map((p, i) => {
                const media = participants.find((x) => x.id === p.identity),
                  voted = s.voted.includes(p.identity)
                return (
                  <button
                    key={p.identity}
                    type="button"
                    className={`impostor-seat ${s.result?.impostor === p.identity ? 'is-impostor' : ''} ${s.result?.accused.includes(p.identity) ? 'is-accused' : ''}`}
                    style={
                      {
                        '--party-seat': i,
                        '--party-count': s.players.length,
                      } as React.CSSProperties
                    }
                    onClick={() => {
                      if (s.phase === 'vote' && player) setConfirm(p.identity)
                    }}
                    disabled={s.phase !== 'vote' || !player}
                    aria-label={`Votar em ${p.name}`}
                  >
                    <ProfileAvatar
                      avatarDataUrl={media?.avatarDataUrl}
                      appearance={media?.appearance}
                      name={p.name}
                    />
                    <strong>{p.name}</strong>
                    <small>
                      {s.phase === 'result'
                        ? `${s.result?.counts[p.identity] || 0} votos`
                        : s.phase === 'vote'
                          ? voted
                            ? 'Votou'
                            : 'Pensando…'
                          : s.requests.includes(p.identity)
                            ? 'Quer votar'
                            : 'Dando pistas'}
                    </small>
                  </button>
                )
              })}
            </div>
          </div>
          {s.phase === 'talk' && player && (
            <div className="impostor-vote-cta">
              <button
                type="button"
                className={`game-action ${requested ? 'game-action--primary' : ''}`}
                aria-pressed={requested}
                onClick={() => game.move({ type: 'request-vote' })}
              >
                <Icon name="users" />
                {requested ? 'Aguardando a maioria' : 'Quero votar'}
                <b>
                  {s.requests.length}/{majority(s.players.length)}
                </b>
              </button>
              <small>Maioria absoluta: metade da sala + 1.</small>
            </div>
          )}
          {s.phase === 'vote' && (
            <div className="impostor-vote-cta">
              <p>
                {s.voted.length} de {s.players.length} já votaram · clique em
                uma pessoa
              </p>
            </div>
          )}
        </>
      )}
      {confirm && (
        <GameModal
          title={`Votar em ${s.players.find((p) => p.identity === confirm)?.name}?`}
          detail="Seu voto só aparece no resultado final."
          onClose={() => setConfirm('')}
        >
          <button
            className="game-action game-action--primary"
            onClick={() => {
              game.move({ type: 'vote', target: confirm })
              setConfirm('')
            }}
          >
            Confirmar voto
          </button>
        </GameModal>
      )}
    </section>
  )
}
