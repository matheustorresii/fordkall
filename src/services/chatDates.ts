export const chatDayKey = (value: string | number) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
export const chatDayLabel = (value: string | number, now = Date.now()) => {
  const d = new Date(value),
    today = new Date(now),
    yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  if (chatDayKey(value) === chatDayKey(now)) return 'Hoje'
  if (chatDayKey(value) === chatDayKey(yesterday.getTime())) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  }).format(d)
}
