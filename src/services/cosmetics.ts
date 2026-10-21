export const COSMETIC_THEMES = [
  ['frangoelho', 'Frangoelho', 'Frangoelho'],
  ['frangoelho-arcade', 'Frangoelho Arcade', 'Frangoelho'],
  ['frangoelho-cloud', 'Frangoelho nas Nuvens', 'Frangoelho'],
  ['avatar-air', 'Templo do Ar', 'Avatar'],
  ['avatar-water', 'Tribo da Água', 'Avatar'],
  ['avatar-fire', 'Nação do Fogo', 'Avatar'],
  ['avatar-earth', 'Reino da Terra', 'Avatar'],
  ['barbie-mermaid', 'Vida de Sereia', 'Barbie'],
  ['barbie-coral', 'Palácio de Coral', 'Barbie'],
  ['barbie-wave', 'Surf Rosa', 'Barbie'],
  ['sakura', 'Sakura', 'Coleção'],
  ['lunar', 'Lunar', 'Coleção'],
  ['ember', 'Brasa', 'Coleção'],
  ['ocean', 'Oceano', 'Coleção'],
  ['arcade', 'Arcade', 'Coleção'],
  ['aurora', 'Aurora', 'Coleção'],
  ['desert', 'Dunas', 'Coleção'],
  ['noir', 'Noir', 'Coleção'],
] as const
export const PROFILE_DECORATIONS = [
  ['botanical', 'Jardim Kiwi', 'Coleção'],
  ['orbit', 'Órbita', 'Coleção'],
  ...COSMETIC_THEMES,
] as const
export const CALL_BACKGROUNDS = [
  ['dusk', 'Crepúsculo', 'Coleção'],
  ['grove', 'Bosque Kiwi', 'Coleção'],
  ...COSMETIC_THEMES,
] as const
export const cosmeticAsset = (kind: 'frame' | 'background', id?: string) =>
  id && id !== 'none'
    ? `${import.meta.env.BASE_URL}cosmetics/${kind}-${id}.webp`
    : undefined
export const validDecoration = (id: unknown) =>
  typeof id === 'string' && PROFILE_DECORATIONS.some((x) => x[0] === id)
    ? id
    : 'none'
export const validBackground = (id: unknown) =>
  typeof id === 'string' && CALL_BACKGROUNDS.some((x) => x[0] === id)
    ? id
    : 'none'
