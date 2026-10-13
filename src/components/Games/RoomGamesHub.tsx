import { Icon } from '../ui/Icon'
import './RoomGamesHub.css'

interface RoomGamesHubProps {
  itoActive: boolean
  itoPlayers: number
  kiwiActive: boolean
  kiwiPlayers: number
  trucoActive: boolean
  trucoPlayers: number
  mindActive: boolean
  mindPlayers: number
  onSelectIto: () => void
  onSelectKiwi: () => void
  onSelectTruco: () => void
  onSelectMind: () => void
  onExit: () => void
}

export const RoomGamesHub = ({
  itoActive,
  itoPlayers,
  kiwiActive,
  kiwiPlayers,
  trucoActive,
  trucoPlayers,
  mindActive,
  mindPlayers,
  onSelectIto,
  onSelectKiwi,
  onSelectTruco,
  onSelectMind,
  onExit,
}: RoomGamesHubProps) => (
  <section className="room-games-hub" aria-label="Central de jogos da sala">
    <header className="room-games-hub__topbar">
      <div className="room-games-hub__brand">
        <span className="room-games-hub__mark"><Icon name="gamepad" /></span>
        <div><small>ATIVIDADES DA SALA</small><strong>Central de jogos</strong></div>
      </div>
      <button
        aria-label="Voltar para a call"
        className="icon-button"
        onClick={onExit}
        title="Voltar para a call"
        type="button"
      >
        <Icon name="x" />
      </button>
    </header>

    <div className="room-games-hub__content">
      <div className="room-games-hub__intro">
        <span>JOGAR EM GRUPO</span>
        <h2>O que vamos jogar?</h2>
        <p>Escolha um jogo para abrir ou retomar. As ações e as cartas privadas sincronizam com quem está na sala.</p>
      </div>

      <div className="room-games-hub__grid">
        <button className="room-game-card room-game-card--ito" onClick={onSelectIto} type="button">
          <span className="room-game-card__topline">
            <span className="room-game-card__art room-game-card__art--ito"><Icon name="users" /></span>
            {itoActive && <span className="room-game-card__status"><i />Partida ativa</span>}
          </span>
          <span className="room-game-card__copy">
            <strong>ITO</strong>
            <span>Leiam as dicas, descubram as intenções e organizem os números em equipe.</span>
          </span>
          <span className="room-game-card__bottomline">
            <span>{itoActive ? `${itoPlayers} na rodada · retomar` : 'Cooperativo · todos jogam'}</span>
            <Icon name="chevron" />
          </span>
        </button>

        <button className="room-game-card room-game-card--kiwi" onClick={onSelectKiwi} type="button">
          <span className="room-game-card__topline">
            <span className="room-game-card__art room-game-card__art--kiwi">
              <img alt="" src="/assets/exploding-kiwi/kiwi-burst.png" />
            </span>
            {kiwiActive && <span className="room-game-card__status"><i />Partida ativa</span>}
          </span>
          <span className="room-game-card__copy">
            <strong>Exploding Kiwi</strong>
            <span>Use suas cartas, evite explodir e seja a última pessoa viva.</span>
          </span>
          <span className="room-game-card__bottomline">
            <span>{kiwiActive ? `${kiwiPlayers} vivas · retomar` : 'Cartas · 2–5 jogadores'}</span>
            <Icon name="chevron" />
          </span>
        </button>

        <button className="room-game-card room-game-card--truco" onClick={onSelectTruco} type="button">
          <span className="room-game-card__topline">
            <span className="room-game-card__art room-game-card__art--truco"><span>♠</span><span>♥</span></span>
            {trucoActive && <span className="room-game-card__status"><i />Partida ativa</span>}
          </span>
          <span className="room-game-card__copy">
            <strong>Truco Mineiro</strong>
            <span>Monte as duplas, esconda suas cartas e aumente a aposta na hora certa.</span>
          </span>
          <span className="room-game-card__bottomline">
            <span>{trucoActive ? `${trucoPlayers}/4 na mesa · retomar` : 'Cartas · 4 jogadores'}</span>
            <Icon name="chevron" />
          </span>
        </button>

        <button className="room-game-card room-game-card--mind" onClick={onSelectMind} type="button">
          <span className="room-game-card__topline">
            <span className="room-game-card__art room-game-card__art--mind"><span>1</span><span>···</span><span>100</span></span>
            {mindActive && <span className="room-game-card__status"><i />Partida ativa</span>}
          </span>
          <span className="room-game-card__copy">
            <strong>The Mind</strong>
            <span>Joguem suas cartas em ordem crescente — sem combinar quem tem qual número.</span>
          </span>
          <span className="room-game-card__bottomline">
            <span>{mindActive ? `${mindPlayers} pessoas · retomar` : 'Cooperativo · 2–4 jogadores'}</span>
            <Icon name="chevron" />
          </span>
        </button>
      </div>
    </div>
  </section>
)
