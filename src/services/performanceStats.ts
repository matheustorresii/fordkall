export interface RtcCounters {
  bytesIn: number
  bytesOut: number
  packets: number
  lost: number
  rttMs: number | null
}
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
/** Never retains candidate addresses, SDP, track IDs, participant names or room codes. */
export function summarizeRtcReports(
  reports: Array<RTCStatsReport | undefined>,
): RtcCounters {
  const seen = new Set<string>(),
    result: RtcCounters = {
      bytesIn: 0,
      bytesOut: 0,
      packets: 0,
      lost: 0,
      rttMs: null,
    }
  for (const report of reports)
    report?.forEach((entry) => {
      if (seen.has(entry.id)) return
      seen.add(entry.id)
      if (entry.type === 'inbound-rtp') {
        result.bytesIn += number(entry.bytesReceived)
        result.packets += number(entry.packetsReceived)
        result.lost += number(entry.packetsLost)
      }
      if (entry.type === 'outbound-rtp')
        result.bytesOut += number(entry.bytesSent)
      if (
        entry.type === 'candidate-pair' &&
        entry.state === 'succeeded' &&
        entry.nominated &&
        typeof entry.currentRoundTripTime === 'number'
      )
        result.rttMs = number(entry.currentRoundTripTime) * 1000
    })
  return result
}
export function rtcRates(
  previous: RtcCounters | null,
  next: RtcCounters,
  elapsedMs: number,
) {
  const seconds = Math.max(0.1, elapsedMs / 1000),
    packets = previous ? Math.max(0, next.packets - previous.packets) : 0,
    lost = previous ? Math.max(0, next.lost - previous.lost) : 0
  return {
    inboundKbps: previous
      ? (Math.max(0, next.bytesIn - previous.bytesIn) * 8) / seconds / 1000
      : null,
    outboundKbps: previous
      ? (Math.max(0, next.bytesOut - previous.bytesOut) * 8) / seconds / 1000
      : null,
    lossPercent: packets + lost ? (lost * 100) / (packets + lost) : null,
    rttMs: next.rttMs,
  }
}
