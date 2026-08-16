import { BrowserPane } from './BrowserPane'

export function App() {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="status-orb status-orb--idle" aria-label="assistant idle" />
        <h1>Bing Bong</h1>
      </header>

      <main className="dashboard-main">
        <BrowserPane />
      </main>

      <footer className="dashboard-footer transcript-placeholder" aria-label="transcript">
        <p>Transcript — voice pipeline arrives in T9/T10.</p>
      </footer>
    </div>
  )
}
