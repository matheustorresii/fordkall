import { useEffect, useState } from 'react'
import type { Room } from 'livekit-client'
import {
  rtcRates,
  summarizeRtcReports,
  type RtcCounters,
} from '../../services/performanceStats'
import { version } from '../../../package.json'
import { Icon } from '../ui/Icon'
import './PerformancePanel.css'
interface Sample {
  cpuPercent: number | null
  memoryMb: number | null
  inboundKbps: number | null
  outboundKbps: number | null
  lossPercent: number | null
  rttMs: number | null
  uiDelayMs: number
}
export function PerformancePanel({ room }: { room: Room }) {
  const [sample, setSample] = useState<Sample | null>(null),
    [copied, setCopied] = useState(false)
  useEffect(() => {
    let stopped = false,
      pending = false,
      previous: RtcCounters | null = null,
      lastAt = 0,
      expected = performance.now() + 2000
    const collect = async () => {
      if (pending || stopped || document.hidden) return
      pending = true
      const now = performance.now(),
        uiDelayMs = Math.max(0, now - expected)
      expected = now + 2000
      try {
        const outgoing = [
          ...room.localParticipant.trackPublications.values(),
        ].find((publication) => publication.track)?.track
        const incoming = [...room.remoteParticipants.values()]
          .flatMap((person) => [...person.trackPublications.values()])
          .find((publication) => publication.track)?.track
        const [sent, received, native] = await Promise.all([
          outgoing?.getRTCStatsReport(),
          incoming?.getRTCStatsReport(),
          window.fordKallDesktop?.getPerformanceSample?.(),
        ])
        const counters = summarizeRtcReports([sent, received]),
          rates = rtcRates(previous, counters, now - lastAt)
        previous = counters
        lastAt = now
        if (!stopped)
          setSample({
            ...rates,
            cpuPercent: native?.cpuPercent ?? null,
            memoryMb: native?.memoryMb ?? null,
            uiDelayMs,
          })
      } catch {
        /* Sampling must never interfere with media or produce call alerts. */
      } finally {
        pending = false
      }
    }
    void collect()
    const timer = window.setInterval(collect, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [room])
  const value = (
    number: number | null | undefined,
    suffix: string,
    digits = 0,
  ) =>
    number === null || number === undefined
      ? '—'
      : `${number.toFixed(digits)}${suffix}`
  return (
    <div className="performance-panel">
      <div className="performance-metrics">
        {[
          ['CPU do app', value(sample?.cpuPercent, '%', 1)],
          ['Memória dos processos', value(sample?.memoryMb, ' MB')],
          ['Latência da conexão', value(sample?.rttMs, ' ms')],
          ['Perda de pacotes', value(sample?.lossPercent, '%', 1)],
          ['Recebendo', value(sample?.inboundKbps, ' kbps')],
          ['Enviando', value(sample?.outboundKbps, ' kbps')],
        ].map(([label, metric]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{metric}</strong>
          </div>
        ))}
      </div>
      <p>
        Amostras a cada 2 segundos, somente enquanto este painel estiver aberto.
        CPU e memória incluem os processos do Ford Kall no desktop; não
        representam os FPS do seu jogo.
      </p>
      {!window.fordKallDesktop && (
        <p>
          O navegador não informa a CPU e memória total desta aplicação de forma
          portátil. Esses campos ficam disponíveis no app desktop.
        </p>
      )}
      <button
        className="settings-secondary-button"
        type="button"
        disabled={!sample}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              JSON.stringify(
                {
                  app: 'Ford Kall',
                  version,
                  platform: window.fordKallDesktop?.platform || 'web',
                  connection: room.state,
                  participants: room.remoteParticipants.size + 1,
                  sample,
                },
                null,
                2,
              ),
            )
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />{' '}
        {copied
          ? 'Diagnóstico copiado'
          : 'Copiar diagnóstico sem dados pessoais'}
      </button>
    </div>
  )
}
