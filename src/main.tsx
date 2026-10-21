import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles-v110.css'
import './pwa/pwa.css'
import { startPwa } from './pwa/store'
import { PwaNotices } from './components/ui/PwaControls'
import { loadDisplayFonts } from './pwa/fonts'

startPwa()
loadDisplayFonts()

const root = createRoot(document.getElementById('root')!)
if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('party-preview')
) {
  void import('./dev/PartyPreview').then(({ PartyPreview }) =>
    root.render(
      <StrictMode>
        <PartyPreview />
      </StrictMode>,
    ),
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('design-preview')
) {
  void import('./dev/DesignPreview').then(({ DesignPreview }) =>
    root.render(
      <StrictMode>
        <DesignPreview />
      </StrictMode>,
    ),
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('microphone-preview')
) {
  void import('./dev/MicrophonePreview').then(({ MicrophonePreview }) =>
    root.render(
      <StrictMode>
        <MicrophonePreview />
      </StrictMode>,
    ),
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('moderation-preview')
) {
  void import('./dev/ModerationPreview').then(({ ModerationPreview }) =>
    root.render(
      <StrictMode>
        <ModerationPreview />
      </StrictMode>,
    ),
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('music-preview')
) {
  void import('./dev/MusicPreview').then(({ MusicPreview }) =>
    root.render(
      <StrictMode>
        <MusicPreview />
      </StrictMode>,
    ),
  )
} else if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('game-preview')
) {
  void import('./dev/GamePreview').then(({ GamePreview }) =>
    root.render(
      <StrictMode>
        <GamePreview />
      </StrictMode>,
    ),
  )
} else {
  root.render(
    <StrictMode>
      <App />
      <PwaNotices />
    </StrictMode>,
  )
}
