import { Icon } from '../ui/Icon'
import './RoomGamesHub.css'

interface RoomGamesHubProps {
  itoActive: boolean
  itoPlayers: number
  kiwiActive: boolean
  kiwiPlayers: number
  onSelectIto: () => void
  onSelectKiwi: () => void
  onExit: () => void
}

export const RoomGamesHub = ({
  itoActive,
  itoPlayers,
  kiwiActive,
  kiwiPlayers,
  onSelectIto,
  onSelectKiwi,
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
        <p>Escolha um jogo para abrir ou retomar. As partidas ficam salvas na sala enquanto vocês conversam.</p>
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
      </div>
    </div>
  </section>
)
