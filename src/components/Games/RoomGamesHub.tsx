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
  codenamesActive: boolean
  codenamesPlayers: number
  excalitowerActive?: boolean
  excalitowerPeople?: number
  onSelectExcalitower: () => void
  garticActive?:boolean
  garticPlayers?:number
  impostorActive?:boolean
  impostorPlayers?:number
  onSelectGartic?:()=>void
  onSelectImpostor?:()=>void
  onSelectIto: () => void
  onSelectKiwi: () => void
  onSelectTruco: () => void
  onSelectMind: () => void
  onSelectPoker: () => void
  onSelectCoup: () => void
  onSelectCodenames: () => void
  onExit: () => void
}
type Category = 'all' | 'cards' | 'cooperative' | 'words' | 'creative'
const PAGE_SIZE = 6
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const CatalogArt = ({ kind }: { kind: string }) => (
  <span aria-hidden="true" className={`game-catalog-art game-catalog-art--${kind}`}>
    {kind === 'gartic' ? <svg viewBox="0 0 230 110"><rect x="45" y="17" width="140" height="83" rx="13" fill="#e1eced" transform="rotate(-6 100 50)"/><path d="M70 70q15-40 27-5t25-10 32-7" fill="none" stroke="#6a9e92" strokeWidth="7" strokeLinecap="round"/><circle cx="159" cy="32" r="8" fill="#e9ba8e"/><path d="m159 78 29-46 9 7-29 46-12 6Z" fill="#8195ce"/></svg> : kind === 'impostor' ? <svg viewBox="0 0 230 110"><circle cx="69" cy="54" r="28" fill="#748eb4"/><circle cx="159" cy="54" r="28" fill="#748eb4"/><path d="M116 12c32 0 41 23 34 48-5 22-21 39-34 44-14-5-30-22-35-44-7-25 2-48 35-48Z" fill="#9882ba" stroke="#d1b4e0" strokeWidth="2"/><text x="116" y="70" textAnchor="middle" fill="#f4e8ff" fontSize="48" fontFamily="system-ui">?</text></svg> : kind === 'excalitower' ? (
      <svg viewBox="0 0 230 110" fill="none"><rect x="24" y="12" width="100" height="74" rx="10" fill="#eff3f5" stroke="#b3d0d0" strokeWidth="2" transform="rotate(-7 24 12)" /><path d="m40 62 23-28 17 16 18-17" stroke="#427779" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><rect x="137" y="36" width="64" height="58" rx="5" fill="#eccf91" transform="rotate(8 137 36)" /><path d="m152 55 31 4m-32 7 21 3" stroke="#937240" strokeWidth="3" strokeLinecap="round" /><path d="m115 86 43-63 8 6-43 63-12 5 4-11Z" fill="#86b6bb" stroke="#315b63" strokeWidth="2" /><path d="m111 97 4-11 8 6-12 5Z" fill="#315b63" /><circle cx="207" cy="20" r="6" fill="#d99a90" /></svg>
    ) : kind === 'codenames' ? (
      ['LUA', 'PONTE', 'ÓRBITA', 'CHAVE', 'MAR', 'ROSA', 'COROA', 'BANCO', 'FOLHA'].map((word, i) =>
        <i className="game-catalog-art__word" data-color={i % 4 === 0 ? 'red' : i % 3 === 0 ? 'blue' : 'neutral'} key={word}>{word}</i>,
      )
    ) : kind === 'coup' ? (
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
    ...(props.onSelectGartic?[{id:'gartic',title:'Gartic Kiwi',subtitle:'Desenha aí.',description:'Palpites, equipes e telefone sem fio.',category:'creative',players:'2–12',active:Boolean(props.garticActive),count:props.garticPlayers||0,open:props.onSelectGartic}]:[]),
    ...(props.onSelectImpostor?[{id:'impostor',title:'Impostor',subtitle:'Fora do contexto',description:'Uma palavra secreta. Uma pessoa disfarçando.',category:'words',players:'3–12',active:Boolean(props.impostorActive),count:props.impostorPlayers||0,open:props.onSelectImpostor}]:[]),
    {
      id: 'excalitower',
      title: 'Excalitower',
      subtitle: 'Ideias à mão livre',
      description: 'Uma lousa para desenhar, escrever e criar juntos.',
      category: 'creative',
      players: '1+',
      active: Boolean(props.excalitowerActive),
      count: props.excalitowerPeople || 0,
      open: props.onSelectExcalitower,
    },
    {
      id: 'codenames',
      title: 'Codenames',
      subtitle: 'Uma pista conecta tudo',
      description: 'Duas equipes, palavras e uma chave secreta.',
      category: 'words',
      players: '4–12',
      active: props.codenamesActive,
      count: props.codenamesPlayers,
      open: props.onSelectCodenames,
    },
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
              { id: 'words', title: 'Palavras' },
              { id: 'creative', title: 'Criar' },
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
                    {game.id === 'excalitower' ? 'Nesta sessão' : 'Em jogo'}
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
                  {game.id === 'excalitower' ? 'Toda a sala' : game.active ? `${game.count} na mesa` : `${game.players} pessoas`}
                </span>
                <b>
                  {game.id === 'excalitower' ? 'Abrir lousa' : game.active ? 'Retomar' : 'Jogar'}
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
