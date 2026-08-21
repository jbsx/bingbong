import { useEffect, useRef } from 'react'
import type { SubagentCard } from '../../core/pipeline/events'
import { HIDDEN_PANE_RECT, type PaneRect } from '../../core/browser/paneState'

// One live card per subagent (issue #13): status, task, and progress. Since
// #57 browse agents show a captured thumbnail of their page instead of the
// page itself — their views live hidden at a desktop viewport, and main
// ships ~1fps in-memory frames on the agent_update payload. Direct in-card
// interaction is gone; Reopen moves the pane into the main browsing area.

function paneRectFrom(rect: DOMRect): PaneRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * The card's thumbnail frame. Doubles as the visibility reporter: its rect
 * rides the existing tab-rect channel so main captures only while the card
 * is actually on screen (a card scrolled out of the rail reports hidden),
 * and its CSS width sizes the frames main sends.
 */
function ThumbnailFrame({ agentId, src }: { agentId: string; src: string | undefined }) {
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const report = () => {
      const rail = frame.closest('.subagent-cards')
      const rect = frame.getBoundingClientRect()
      const visible = rail === null || intersects(rect, rail.getBoundingClientRect())
      window.bingbong.subagents.reportTabRect(agentId, visible ? paneRectFrom(rect) : HIDDEN_PANE_RECT)
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(frame)
    const cards = frame.closest('.subagent-cards')
    cards?.addEventListener('scroll', report, { passive: true })
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      cards?.removeEventListener('scroll', report)
      window.removeEventListener('resize', report)
      window.bingbong.subagents.reportTabRect(agentId, HIDDEN_PANE_RECT)
    }
  }, [agentId])

  return (
    <div className="subagent-thumbnail-frame" ref={frameRef} aria-label={`subagent ${agentId} page preview`}>
      {src ? <img className="subagent-thumbnail" src={src} alt="" /> : null}
    </div>
  )
}

function statusLabel(agent: SubagentCard): string {
  if (agent.status === 'running') return agent.lastAction ? `running — ${agent.lastAction}` : 'running'
  return agent.status
}

export function SubagentCardView({ agent }: { agent: SubagentCard }) {
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
        {agent.tab ? (
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
      {agent.tab ? <ThumbnailFrame agentId={agent.id} src={agent.tab.thumbnail} /> : null}
      {agent.tab && agent.tab.phase === 'closed' ? (
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
