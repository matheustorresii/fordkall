import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('game-preview')) {
  void import('./dev/GamePreview').then(({ GamePreview }) => root.render(<StrictMode><GamePreview /></StrictMode>))
} else {
  root.render(<StrictMode><App /></StrictMode>)
}
