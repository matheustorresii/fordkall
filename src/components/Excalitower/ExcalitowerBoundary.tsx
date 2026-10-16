import { Component, type ReactNode } from 'react'

// A failed editor download/render must not unmount the voice call or its in-memory replica.
export class ExcalitowerBoundary extends Component<{ children: ReactNode; onExit: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <div role="alert" style={{ display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 14, height: '100%', padding: 24, textAlign: 'center', color: 'var(--text-primary)' }}>
      <strong>Não foi possível abrir o Excalitower.</strong>
      <span>Sua call continua conectada. Verifique a conexão e atualize o aplicativo para tentar novamente.</span>
      <button className="game-action" onClick={this.props.onExit} type="button">Voltar à call</button>
    </div>
  }
}
