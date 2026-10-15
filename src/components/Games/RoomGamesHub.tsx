import { useState } from 'react'
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
  pokerActive: boolean
  pokerPlayers: number
  coupActive: boolean
  coupPlayers: number
  onSelectIto: () => void
  onSelectKiwi: () => void
  onSelectTruco: () => void
  onSelectMind: () => void
  onSelectPoker: () => void
  onSelectCoup: () => void
  onExit: () => void
}
type Category = 'all' | 'cards' | 'cooperative'
const PAGE_SIZE = 6
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const CatalogArt = ({ kind }: { kind: string }) => (
  <span aria-hidden="true" className={`game-catalog-art game-catalog-art--${kind}`}>
    {kind === 'coup' ? (
      <><img className="game-catalog-art__coup-side" alt="" src="/assets/coup/assassin.webp" /><img alt="" src="/assets/coup/duke.webp" /></>
    ) : kind === 'kiwi' ? (
      <img alt="" src="/assets/exploding-kiwi/kiwi-burst.png" />
    ) : kind === 'poker' ? (
      <>
        <i>
          A<span>♠</span>
        </i>
        <i>
          A<span>♥</span>
        </i>
        <b className="game-catalog-art__chips" />
      </>
    ) : kind === 'truco' ? (
      <>
        <i>
          4<span>♣</span>
        </i>
        <i>
          7<span>♥</span>
        </i>
      </>
    ) : kind === 'ito' ? (
      <>
        <i>12</i>
        <i>72</i>
        <b className="game-catalog-art__scale">0 — 100</b>
      </>
    ) : (
      <>
        <i>1</i>
        <i>100</i>
        <b className="game-catalog-art__star">✦</b>
      </>
    )}
  </span>
)

export const RoomGamesHub = (props: RoomGamesHubProps) => {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [page, setPage] = useState(0)
  // A catalog entry is all a new game needs here; pagination bounds the layout as it grows.
  const catalog = [
    {
      id: 'coup',
      title: 'Coup',
      subtitle: 'Corte Kiwi',
      description: 'Duas influências. Um bom blefe. Uma coroa.',
      category: 'cards',
      players: '2–6',
      active: props.coupActive,
      count: props.coupPlayers,
      open: props.onSelectCoup,
    },
    {
      id: 'poker',
      title: 'Poker',
      subtitle: 'Texas Hold’em',
      description: 'Blefe, aposte e leve o pote.',
      category: 'cards',
      players: '2–6',
      active: props.pokerActive,
      count: props.pokerPlayers,
      open: props.onSelectPoker,
    },
    {
      id: 'kiwi',
      title: 'Exploding Kiwi',
      subtitle: 'Último kiwi de pé',
      description: 'Compre uma carta. Torça para não explodir.',
      category: 'cards',
      players: '2–5',
      active: props.kiwiActive,
      count: props.kiwiPlayers,
      open: props.onSelectKiwi,
    },
    {
      id: 'truco',
      title: 'Truco Mineiro',
      subtitle: 'Vale seis?',
      description: 'Sua dupla, suas cartas e um bom blefe.',
      category: 'cards',
      players: '4',
      active: props.trucoActive,
      count: props.trucoPlayers,
      open: props.onSelectTruco,
    },
    {
      id: 'ito',
      title: 'ITO',
      subtitle: 'Entre 0 e 100',
      description: 'Uma dica, muitos jeitos de interpretar.',
      category: 'cooperative',
      players: '2–8',
      active: props.itoActive,
      count: props.itoPlayers,
      open: props.onSelectIto,
    },
    {
      id: 'mind',
      title: 'The Mind',
      subtitle: 'No mesmo ritmo',
      description: 'Joguem em ordem. Sem contar os números.',
      category: 'cooperative',
      players: '2–4',
      active: props.mindActive,
      count: props.mindPlayers,
      open: props.onSelectMind,
    },
  ]
  const filtered = catalog.filter(
    (game) =>
      (category === 'all' || category === game.category) &&
      normalize(`${game.title} ${game.subtitle}`).includes(normalize(query.trim())),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  return (
    <section aria-label="Central de jogos da sala" className="room-games-hub">
      <header className="room-games-hub__topbar">
        <span>Central de jogos</span>
        <button
          aria-label="Voltar para a call"
          className="game-icon-button"
          onClick={props.onExit}
          title="Voltar para a call"
          type="button"
        >
          <Icon name="x" />
        </button>
      </header>
      <div className="room-games-hub__content">
        <div className="room-games-hub__heading">
          <div>
            <h1>Qual vai ser?</h1>
            <p>Escolha um jogo e reúna a sala.</p>
          </div>
          <label className="room-games-hub__search">
            <Icon name="search" />
            <input
              aria-label="Buscar jogo"
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(0)
              }}
              placeholder="Buscar jogo"
              type="search"
              value={query}
            />
          </label>
        </div>
        <nav aria-label="Filtrar jogos" className="room-games-hub__filters">
          {(
            [
              { id: 'all', title: 'Todos' },
              { id: 'cards', title: 'Cartas' },
              { id: 'cooperative', title: 'Cooperativos' },
            ] as const
          ).map((filter) => (
            <button
              aria-pressed={category === filter.id}
              className={category === filter.id ? 'is-selected' : ''}
              key={filter.id}
              onClick={() => {
                setCategory(filter.id)
                setPage(0)
              }}
              type="button"
            >
              {filter.title}
            </button>
          ))}
        </nav>
        <div
          aria-label="Jogos disponíveis"
          className={`room-games-hub__grid ${visible.length <= 3 ? 'room-games-hub__grid--short' : ''}`}
        >
          {visible.map((game) => (
            <button
              className={`game-catalog-card game-catalog-card--${game.id} ${game.active ? 'is-active' : ''}`}
              key={game.id}
              onClick={game.open}
              type="button"
            >
              <span className="game-catalog-card__visual">
                <CatalogArt kind={game.id} />
                {game.active && (
                  <span className="game-catalog-card__live">
                    <i />
                    Em jogo
                  </span>
                )}
              </span>
              <span className="game-catalog-card__copy">
                <small>{game.subtitle}</small>
                <strong>{game.title}</strong>
                <span>{game.description}</span>
              </span>
              <span className="game-catalog-card__footer">
                <span>
                  <Icon name="users" />
                  {game.active ? `${game.count} na mesa` : `${game.players} pessoas`}
                </span>
                <b>
                  {game.active ? 'Retomar' : 'Jogar'}
                  <Icon name="chevron" />
                </b>
              </span>
            </button>
          ))}
          {!visible.length && (
            <div className="room-games-hub__empty">
              <Icon name="search" />
              <strong>Nenhum jogo encontrado</strong>
              <button
                onClick={() => {
                  setQuery('')
                  setCategory('all')
                }}
                type="button"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>
        <footer className="room-games-hub__footer">
          <span>
            {filtered.length} {filtered.length === 1 ? 'jogo' : 'jogos'}
            {catalog.some((game) => game.active) && ' · Sua partida continua ativa'}
          </span>
          {pages > 1 && (
            <nav aria-label="Páginas de jogos">
              <button
                aria-label="Página anterior"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
                type="button"
              >
                <Icon name="chevron" />
              </button>
              <span>
                {currentPage + 1} / {pages}
              </span>
              <button
                aria-label="Próxima página"
                disabled={currentPage === pages - 1}
                onClick={() => setPage(currentPage + 1)}
                type="button"
              >
                <Icon name="chevron" />
              </button>
            </nav>
          )}
        </footer>
      </div>
    </section>
  )
}
