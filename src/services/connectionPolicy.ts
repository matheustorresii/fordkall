export const connectionFailureMessage = (code: string): string | null =>
  ({
    LIVEKIT_POOL_UNAVAILABLE:
      'Nenhum servidor de chamadas está disponível no momento. Os projetos podem estar sem cota ou temporariamente indisponíveis. Tente novamente mais tarde.',
    LIVEKIT_ROOM_UNAVAILABLE:
      'O servidor desta sala não permitiu a conexão. Não trocamos uma sala em uso de servidor para não separar as pessoas. Tente novamente em instantes.',
    LIVEKIT_CLIENT_CONNECTION_FAILED:
      'Não foi possível abrir a conexão de voz nos servidores tentados. Verifique sua rede, VPN ou firewall e tente novamente.',
    LIVEKIT_QUOTA_EXCEEDED:
      'O projeto de chamadas atingiu um limite e não há outra opção disponível agora. Aguarde a liberação da cota ou avise o administrador.',
    LIVEKIT_NOT_CONFIGURED:
      'O servidor de chamadas ainda não recebeu as credenciais do LiveKit.',
  })[code] || null

export function connectionFailureStatus(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const error = value as { status?: unknown; context?: { status?: unknown } }
  const status = error.status ?? error.context?.status
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : null
}
