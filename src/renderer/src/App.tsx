export function App() {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="status-orb status-orb--idle" aria-label="assistant idle" />
        <h1>Bing Bong</h1>
      </header>

      <main className="dashboard-main">
        <section className="browser-pane-placeholder" aria-label="browser pane">
          <p className="placeholder-title">Browser pane</p>
          <p className="placeholder-note">The embedded Chromium arrives in T2.</p>
        </section>
      </main>

      <footer className="dashboard-footer transcript-placeholder" aria-label="transcript">
        <p>Transcript — voice pipeline arrives in T9/T10.</p>
      </footer>
    </div>
  )
}
