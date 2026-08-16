import { BrowserPane } from './BrowserPane'
import { AssistantPanel, StatusOrb } from './AssistantPanel'
import { useAssistant } from './useAssistant'

export function App() {
  const assistant = useAssistant()

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <StatusOrb status={assistant.status} />
        <h1>Bing Bong</h1>
      </header>

      <main className="dashboard-main">
        <BrowserPane />
      </main>

      <footer className="dashboard-footer">
        <AssistantPanel assistant={assistant} />
      </footer>
    </div>
  )
}
