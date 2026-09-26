import { describe, expect, it } from 'vitest'
import { launchDecisionSeamsOf, launchRoutingOf } from './launchRouting.ts'
import type { LiveLaunchProvenance } from './types.ts'

// The routing a set's launches read as (#279): the Decision Model's role is
// one more role string when a launch recorded it, and none when it predates
// #279, so an old Pass's routing reads exactly as it always did.

const agentRoles: LiveLaunchProvenance['roles'] = {
  orchestrator: { configured: true, baseUrl: 'https://o.example', model: 'GLM-5.3', keyFingerprint: 'sha256:o' },
  subagent: { configured: true, baseUrl: 'https://s.example', model: 'GLM-5.3-flash', keyFingerprint: 'sha256:s' },
  vision: { configured: false, reason: 'not configured in the production env' },
}

describe('launchRoutingOf', () => {
  it('reads a launch before #279 as the three agent roles', () => {
    expect(launchRoutingOf([{ roles: agentRoles }])).toEqual([
      'orchestrator=GLM-5.3',
      'subagent=GLM-5.3-flash',
      'vision=unconfigured (not configured in the production env)',
    ])
  })

  it('adds the decision role, configured or not — the arm marker', () => {
    const on = launchRoutingOf([{ roles: { ...agentRoles, decision: { configured: true, baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0', keyFingerprint: 'sha256:d' } } }])
    const off = launchRoutingOf([{ roles: { ...agentRoles, decision: { configured: false, reason: 'not configured in the production env' } } }])
    expect(on).toContain('decision=jev-1.13.0')
    expect(off).toContain('decision=unconfigured (not configured in the production env)')
    expect(on.filter((role) => !role.startsWith('decision='))).toEqual(off.filter((role) => !role.startsWith('decision=')))
  })

  it('lists each distinct role string once across the launches of a set', () => {
    expect(launchRoutingOf([{ roles: agentRoles }, { roles: agentRoles }])).toHaveLength(3)
  })
})

describe('launchDecisionSeamsOf', () => {
  it('is null when no launch forwarded a seam list, and joins distinct lists otherwise', () => {
    expect(launchDecisionSeamsOf([{}, { decisionSeams: null }])).toBeNull()
    expect(launchDecisionSeamsOf([{ decisionSeams: 'tier' }, { decisionSeams: 'tier' }])).toBe('tier')
    expect(launchDecisionSeamsOf([{ decisionSeams: 'tier' }, { decisionSeams: 'passage' }])).toBe('passage | tier')
  })
})
