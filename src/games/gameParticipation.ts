export const GAME_KINDS = ['ito', 'kiwi', 'truco', 'mind', 'poker', 'coup', 'codenames'] as const
export type GameKind = typeof GAME_KINDS[number]
export interface GameAttendance { organizer: string; spectators: string[] }
export type GameAttendanceMap = Record<GameKind, GameAttendance>
export const GAME_LIMITS: Record<GameKind, { name: string; min: number; max: number; leaving: string }> = {
  ito: { name: 'ITO', min: 2, max: 8, leaving: 'A rodada será redistribuída entre quem ficar, sem contar como derrota.' },
  kiwi: { name: 'Exploding Kiwi', min: 2, max: 5, leaving: 'Você sai desta rodada. Se houver uma ação pendente envolvendo você, ela será cancelada.' },
  truco: { name: 'Truco Mineiro', min: 4, max: 4, leaving: 'A partida será encerrada: o Truco precisa das quatro pessoas.' },
  mind: { name: 'The Mind', min: 2, max: 4, leaving: 'O nível será redistribuído entre quem ficar, sem perder uma vida.' },
  poker: { name: 'Poker', min: 2, max: 6, leaving: 'Sua mão é abandonada. Fichas já apostadas continuam no pote e os outros seguem jogando.' },
  coup: { name: 'Coup', min: 2, max: 6, leaving: 'Você sai da partida e os outros continuam jogando.' },
  codenames: { name: 'Codenames', min: 4, max: 12, leaving: 'A mesa volta à escolha de equipes, sem revelar a chave.' },
}
export const emptyGameAttendance = (): GameAttendanceMap => Object.fromEntries(GAME_KINDS.map((kind) => [kind, { organizer: '', spectators: [] }])) as unknown as GameAttendanceMap
export const readGameAttendance = (value: unknown): GameAttendanceMap | null => {
  if (!value || typeof value !== 'object') return null
  const games = emptyGameAttendance()
  for (const kind of GAME_KINDS) {
    const row = (value as Record<string, GameAttendance>)[kind]
    if (!row || typeof row.organizer !== 'string' || row.organizer.length > 128 || !Array.isArray(row.spectators) || row.spectators.length > 128 ||
      row.spectators.some((id) => typeof id !== 'string' || !id || id.length > 128) || new Set(row.spectators).size !== row.spectators.length || row.spectators.includes(row.organizer)) return null
    games[kind] = { organizer: row.organizer, spectators: [...row.spectators] }
  }
  return games
}
export const changeGameAttendance = (games: GameAttendanceMap, kind: GameKind, sender: string, target: string, playing: boolean, connected: string[]): GameAttendanceMap => {
  if (!connected.includes(sender) || !connected.includes(target)) throw new Error('Essa pessoa não está mais na call.')
  const current = games[kind]
  const activeOrganizer = connected.includes(current.organizer) ? current.organizer : ''
  if (sender !== target && current.spectators.includes(sender)) throw new Error('Quem está só assistindo não pode organizar os outros jogadores.')
  if (sender !== target && playing) throw new Error('Só a própria pessoa pode voltar a participar.')
  if (sender !== target && activeOrganizer && activeOrganizer !== sender) throw new Error('Só quem organiza a mesa pode mover outra pessoa para espectador.')
  const spectators = current.spectators.filter((id) => id !== target)
  if (!playing) spectators.push(target)
  let organizer = activeOrganizer || (sender !== target ? sender : '')
  if (spectators.includes(organizer) || organizer && !connected.includes(organizer)) organizer = connected.find((id) => !spectators.includes(id)) ?? ''
  return { ...games, [kind]: { organizer, spectators } }
}
