import { Component, type ReactNode } from 'react'

/** If a screen crashes, show what happened and a Reload button instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="login">
        <h1>Something went wrong</h1>
        <p className="muted">Your logged sets are saved on this phone. Reloading usually fixes it.</p>
        <pre className="notes">{this.state.error.name}: {this.state.error.message}</pre>
        <button className="primary finish" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
