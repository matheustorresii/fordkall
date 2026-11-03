import type { CSSProperties } from 'react'
import { odinClans, type OdinCard, type OdinClan } from '../../games/odin'
import './OdinCard.css'

/** Original vector art: six Kiwi clans, with a redundant shape as well as color. */
export const OdinKiwi = ({ clan = 'leaf' }: { clan?: OdinClan }) => (
  <svg
    aria-hidden="true"
    className="odin-kiwi"
    viewBox="0 0 180 180"
    fill="none"
  >
    <circle
      cx="90"
      cy="90"
      r="73"
      stroke="currentColor"
      strokeWidth="1"
      opacity=".2"
    />
    <circle
      cx="90"
      cy="90"
      r="64"
      stroke="currentColor"
      strokeDasharray="2 8"
      opacity=".28"
    />
    <path
      d="M57 127 51 142m20-12-2 15m-20-3 12 1m4 2 11-1"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <path
      d="M43 100c0-29 21-51 46-51 22 0 40 21 40 43 0 30-24 49-47 49-24 0-39-14-39-41Z"
      fill="currentColor"
      opacity=".16"
    />
    <path
      d="M45 102c0-26 19-49 44-49 20 0 37 17 37 40 0 29-21 47-44 47-24 0-37-13-37-38Z"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      d="m119 82 39 18-37-8M54 78l7 6m-8 14 7 3m1-40 7 5m8-13 4 7m9-9 1 6M76 91c-13 2-20 13-17 24 16 0 26-9 27-19"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="110" cy="77" r="4" fill="currentColor" />
    <circle cx="111" cy="76" r="1" fill="#fff9e8" />
    {clan === 'leaf' && (
      <path
        d="M82 52c-11-13-9-25-9-25 18 3 24 16 21 27m-11-5-7-17m17 22c-1-16 13-23 13-23 7 14 0 24-13 23Z"
        fill="currentColor"
        opacity=".8"
      />
    )}
    {clan === 'tide' && (
      <>
        <path
          d="M65 46c4-7 11 7 16 0s12 7 17 0m-26-8c4-7 11 7 16 0s12 7 17 0M43 115c17 1 23 5 38 11"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="m58 137-6 10 22-2 12-13" fill="currentColor" opacity=".5" />
      </>
    )}
    {clan === 'sun' && (
      <>
        <circle cx="88" cy="37" r="9" fill="currentColor" opacity=".7" />
        <path
          d="M88 17v5m0 30v5m-20-20h5m30 0h5M74 23l4 4m20 20 4 4M74 51l4-4m20-20 4-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    )}
    {clan === 'ember' && (
      <>
        <path
          d="m74 56 13-34 17 33-17-10-13 11Z"
          fill="currentColor"
          opacity=".8"
        />
        <path
          d="m83 122 8 8 8-8-8-8-8 8Z"
          stroke="currentColor"
          strokeWidth="2"
        />
      </>
    )}
    {clan === 'moon' && (
      <>
        <path
          d="M95 21a18 18 0 1 0 13 27c-18 3-27-11-13-27Z"
          fill="currentColor"
          opacity=".75"
        />
        <path
          d="m56 61-3-6m75 58 6 3m-5-53 3-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    )}
    {clan === 'bloom' && (
      <>
        <path
          d="M83 48c-20-7-15-22-5-19-2-14 15-17 17-5 10-10 22 3 13 12 13 3 10 18-3 17"
          fill="currentColor"
          opacity=".65"
        />
        <circle cx="93" cy="40" r="7" fill="#fff9e8" opacity=".85" />
        <path
          d="M51 115c6-10 16-10 22-4"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </>
    )}
  </svg>
)

export const OdinCardFace = ({
  card,
  back = false,
}: {
  card?: OdinCard
  back?: boolean
}) => {
  const clan = odinClans[card?.clan || 'leaf']
  return (
    <span
      className={`odin-card ${back ? 'odin-card--back' : ''}`}
      style={{ '--clan': clan.color, '--clan-ink': clan.ink } as CSSProperties}
    >
      {back ? (
        <>
          <OdinKiwi />
          <span className="odin-card__wordmark">ODIN</span>
        </>
      ) : (
        card && (
          <>
            <span className="odin-card__corner">
              <b>{card.value}</b>
              <i>{clan.symbol}</i>
            </span>
            <OdinKiwi clan={card.clan} />
            <span className="odin-card__clan">{clan.name}</span>
            <span
              aria-hidden="true"
              className="odin-card__corner odin-card__corner--bottom"
            >
              <b>{card.value}</b>
              <i>{clan.symbol}</i>
            </span>
          </>
        )
      )}
    </span>
  )
}
