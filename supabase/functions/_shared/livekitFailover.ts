// No SDK dependencies: the admission check can be tested without opening media or a room.
export type AdmissionCode =
  | 'OK'
  | 'QUOTA_EXCEEDED'
  | 'AUTH_REJECTED'
  | 'REGION_UNAVAILABLE'
  | 'BACKEND_UNAVAILABLE'
  | 'VALIDATION_UNAVAILABLE'
export interface AdmissionResult {
  ok: boolean
  code: AdmissionCode
  httpStatus: number | null
  gatewayStatus?: number
}
export class AdmissionFailure extends Error {
  admission: AdmissionResult
  constructor(admission: AdmissionResult) {
    super(admission.code)
    this.admission = admission
  }
}
export type RoomOccupancy = 'occupied' | 'empty' | 'unknown'

export function classifyAdmission(
  status: number,
  text: string,
): AdmissionResult {
  if (status >= 200 && status < 300)
    return { ok: true, code: 'OK', httpStatus: status }
  const code: AdmissionCode =
    /quota|exceed.{0,40}(limit|allowance)|(?:limit|allowance).{0,40}(exceed|reach)|credits? exhausted|insufficient credits|billing|payment required|participant limit/i.test(
      text,
    ) ||
    status === 402 ||
    status === 429
      ? 'QUOTA_EXCEEDED'
      : /region/i.test(text) && status === 403
        ? 'REGION_UNAVAILABLE'
        : status === 401 || status === 403
          ? 'AUTH_REJECTED'
          : status >= 500
            ? 'BACKEND_UNAVAILABLE'
            : 'VALIDATION_UNAVAILABLE'
  return { ok: false, code, httpStatus: status }
}

export async function probeLiveKitAdmission(
  serverUrl: string,
  participantToken: string,
  request: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<AdmissionResult> {
  const url = new URL(serverUrl.replace(/^wss:/i, 'https:'))
  // The v0 validate route needs only the signed join grant (v1 also requires a protobuf join_request).
  url.pathname = `${url.pathname.replace(/\/$/, '')}/rtc/validate`
  url.search = ''
  url.searchParams.set('protocol', '16')
  try {
    const signal = AbortSignal.timeout(timeoutMs)
    const options: RequestInit = {
      headers: { Authorization: `Bearer ${participantToken}` },
      redirect: 'manual',
      signal,
    }
    // Cloud may leave /validate reachable after rejecting /rtc/v1 with 429.
    // No Upgrade header: the RTC service returns 404 before starting a session.
    // A gateway quota/availability rejection still happens before that handler.
    const gatewayUrl = new URL(serverUrl.replace(/^wss:/i, 'https:'))
    gatewayUrl.pathname = `${gatewayUrl.pathname.replace(/\/$/, '')}/rtc/v1`
    gatewayUrl.search = ''
    const gateway = await request(gatewayUrl, options)
    const gatewayAdmission = classifyAdmission(
      gateway.status,
      (await gateway.text()).slice(0, 4096),
    )
    if (
      gatewayAdmission.code === 'QUOTA_EXCEEDED' ||
      gatewayAdmission.code === 'BACKEND_UNAVAILABLE'
    )
      return gatewayAdmission
    const response = await request(url, {
      ...options,
    })
    // Never retain upstream bodies, URLs, participant identities or tokens in diagnostics.
    return {
      ...classifyAdmission(
        response.status,
        (await response.text()).slice(0, 4096),
      ),
      gatewayStatus: gateway.status,
    }
  } catch {
    return { ok: false, code: 'BACKEND_UNAVAILABLE', httpStatus: null }
  }
}

export async function inspectRoomOccupancy(
  inspect: () => Promise<unknown[]>,
  timeoutMs = 4000,
): Promise<RoomOccupancy> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const people = await Promise.race([
      inspect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('INSPECTION_TIMEOUT')), timeoutMs)
      }),
    ])
    return people.length ? 'occupied' : 'empty'
  } catch (error) {
    // A failed admin API is not proof that the room is empty.
    const details = error as { code?: string; message?: string }
    if (
      details?.code === 'not_found' &&
      /room.{0,40}(not.{0,12}(found|exist)|missing)|(?:not found|does not exist).{0,40}room/i.test(
        details.message || '',
      )
    )
      return 'empty'
    return 'unknown'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function admitIssuedConnection(
  connection: { serverUrl: string; participantToken: string },
  request: typeof fetch = fetch,
) {
  const admission = await probeLiveKitAdmission(
    connection.serverUrl,
    connection.participantToken,
    request,
  )
  if (
    !admission.ok &&
    !['VALIDATION_UNAVAILABLE', 'REGION_UNAVAILABLE'].includes(admission.code)
  )
    throw new AdmissionFailure(admission)
  return admission
}

export function failureDecision(
  admission: AdmissionResult,
  occupancy: RoomOccupancy,
  confirmedRoom: boolean,
) {
  return {
    code: admission.ok ? 'CLIENT_SIGNAL_FAILED' : admission.code,
    markBackendFailed:
      !admission.ok &&
      !['VALIDATION_UNAVAILABLE', 'REGION_UNAVAILABLE'].includes(
        admission.code,
      ),
    preserveRoom:
      occupancy === 'occupied' || (occupancy === 'unknown' && confirmedRoom),
  }
}

export function normalizeFailedBackends(value: unknown, available: string[]) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string =>
              typeof id === 'string' && available.includes(id),
          ),
        ),
      ].slice(0, 12)
    : []
}
