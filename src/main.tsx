import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('excalitower-preview')) {
  void import('./dev/ExcalitowerPreview').then(({ ExcalitowerPreview }) => root.render(<StrictMode><ExcalitowerPreview /></StrictMode>))
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('microphone-preview')) {
  void import('./dev/MicrophonePreview').then(({ MicrophonePreview }) => root.render(<StrictMode><MicrophonePreview /></StrictMode>))
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('moderation-preview')) {
  void import('./dev/ModerationPreview').then(({ ModerationPreview }) => root.render(<StrictMode><ModerationPreview /></StrictMode>))
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('music-preview')) {
  void import('./dev/MusicPreview').then(({ MusicPreview }) => root.render(<StrictMode><MusicPreview /></StrictMode>))
} else if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('game-preview')) {
  void import('./dev/GamePreview').then(({ GamePreview }) => root.render(<StrictMode><GamePreview /></StrictMode>))
} else {
  root.render(<StrictMode><App /></StrictMode>)
}
