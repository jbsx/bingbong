import { useEffect, useRef } from 'react'
import type { SubagentCard } from '../../core/pipeline/events'
import { HIDDEN_PANE_RECT, type PaneRect } from '../../core/browser/paneState'

// One live card per subagent (issue #13): status, task, progress, and — for
// browse agents — a viewport whose rect drives the window's
// WebContentsView. Closed tabs keep their card with a Reopen button; running
// agents offer Cancel (the same cancel_agent path, by card instead of voice).

function paneRectFrom(rect: DOMRect): PaneRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function TabViewport({ agentId }: { agentId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const report = () => {
      window.bingbong.subagents.reportTabRect(agentId, paneRectFrom(viewport.getBoundingClientRect()))
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(viewport)
    const cards = viewport.closest('.subagent-cards')
    cards?.addEventListener('scroll', report, { passive: true })
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      cards?.removeEventListener('scroll', report)
      window.removeEventListener('resize', report)
      window.bingbong.subagents.reportTabRect(agentId, HIDDEN_PANE_RECT)
    }
  }, [agentId])

  return <div className="subagent-viewport" ref={viewportRef} aria-label={`subagent ${agentId} tab`} />
}

function statusLabel(agent: SubagentCard): string {
  if (agent.status === 'running') return agent.lastAction ? `running — ${agent.lastAction}` : 'running'
  return agent.status
}

export function SubagentCardView({ agent }: { agent: SubagentCard }) {
  const hasLiveTab = agent.tab !== undefined && agent.tab.phase !== 'closed'

  return (
    <article className={`subagent-card subagent-card--${agent.status}`} aria-label={`subagent ${agent.id}`}>
      <header className="subagent-card-header">
        <span className="subagent-card-id">
          {agent.id} · {agent.kind}
        </span>
        <span className={`subagent-card-status subagent-card-status--${agent.status}`}>{statusLabel(agent)}</span>
        {agent.status === 'running' ? (
          <button
            type="button"
            className="chrome-button subagent-cancel"
            onClick={() => void window.bingbong.subagents.cancel(agent.id)}
          >
            Cancel
          </button>
        ) : null}
        {agent.tab && agent.tab.phase === 'closed' ? (
          <button
            type="button"
            className="chrome-button subagent-reopen"
            onClick={() => void window.bingbong.subagents.reopenTab(agent.id)}
          >
            Reopen
          </button>
        ) : null}
      </header>
      <p className="subagent-card-task">{agent.task}</p>
      {hasLiveTab ? <TabViewport agentId={agent.id} /> : null}
      {agent.tab && !hasLiveTab ? (
        <p className="subagent-card-url">
          last page: {agent.tab.url === '' ? '(none)' : agent.tab.url}
        </p>
      ) : null}
      {agent.status === 'completed' && agent.result ? (
        <details className="subagent-card-result">
          <summary>result</summary>
          <pre>{agent.result}</pre>
        </details>
      ) : null}
      {agent.status === 'failed' && agent.error ? (
        <p className="subagent-card-error">{agent.error}</p>
      ) : null}
    </article>
  )
}

export function SubagentCards({ agents }: { agents: SubagentCard[] }) {
  if (agents.length === 0) return null
  return (
    <section className="subagent-cards" aria-label="subagents">
      {agents.map((agent) => (
        <SubagentCardView key={agent.id} agent={agent} />
      ))}
    </section>
  )
}
