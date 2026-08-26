import { describe, expect, it } from 'vitest'
import type { BrowserController, VisualGroundingController } from '../../core/ports/browser'
import { createAuthPopupDirector, type AuthPopupSource } from './authPopupDirector'

type DrivenController = BrowserController & VisualGroundingController

/** Records every call; returns canned results. */
function fakeController(name: string): DrivenController & { calls: string[] } {
  const calls: string[] = []
  const record = <T>(method: string, result: T) => {
    return async (..._args: unknown[]) => {
      calls.push(method)
      return result
    }
  }
  return {
    calls,
    navigate: record('navigate', `navigated by ${name}`),
    readPage: record('readPage', `page of ${name}`),
    click: record('click', `clicked by ${name}`),
    type: record('type', `typed by ${name}`),
    scroll: record('scroll', `scrolled by ${name}`),
    screenshot: record('screenshot', new Uint8Array()),
    back: record('back', `back by ${name}`),
    forward: record('forward', `forward by ${name}`),
    pressKey: record('pressKey', undefined),
    mediaState: record('mediaState', null),
    state: () => ({ url: `https://${name}.example/`, title: name }),
    pageFacts: record('pageFacts', { url: `https://${name}.example/`, title: name, bodyText: '', refs: [] }),
    describeRef: record('describeRef', undefined),
    groundingSnapshot: record('groundingSnapshot', { refs: [], url: `https://${name}.example/` }),
    refAtPoint: record('refAtPoint', 1),
  } as unknown as DrivenController & { calls: string[] }
}

/** Minimal BrowserWindow stand-in driving the director's lifecycle hooks. */
function fakeWindow(url: string, destroyed = false): {
  win: Electron.BrowserWindow
  webContents: Electron.WebContents
  close(): void
} {
  const listeners = { closed: new Set<() => void>(), destroyed: new Set<() => void>() }
  let isDestroyed = destroyed
  const webContents = {
    isDestroyed: () => isDestroyed,
    getURL: () => url,
    once: (_event: 'destroyed', handler: () => void) => listeners.destroyed.add(handler),
  } as unknown as Electron.WebContents
  const win = {
    webContents,
    isDestroyed: () => isDestroyed,
    once: (_event: 'closed', handler: () => void) => listeners.closed.add(handler),
  } as unknown as Electron.BrowserWindow
  return {
    win,
    webContents,
    close() {
      isDestroyed = true
      for (const handler of listeners.closed) handler()
      for (const handler of listeners.destroyed) handler()
    },
  }
}

/** A popup source tests can emit from, plus the created window handles. */
function harness() {
  const pane = fakeController('pane')
  const popup = fakeController('popup')
  const popups: ReturnType<typeof fakeWindow>[] = []
  const listeners = new Set<(win: Electron.BrowserWindow) => void>()
  const source: AuthPopupSource = {
    onAuthPopup(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const director = createAuthPopupDirector(source, {
    createController: (webContents) => {
      expect(popups.some((opened) => opened.webContents === webContents)).toBe(true)
      return popup
    },
  })
  // The director defers its attach one tick (setImmediate) off the pane's
  // drain call, so emitting a popup settles on the next loop turn.
  const openPopup = async (url: string, destroyed = false): Promise<void> => {
    const created = fakeWindow(url, destroyed)
    popups.push(created)
    for (const listener of listeners) listener(created.win)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return { pane, popup, director, openPopup, popups }
}

describe('createAuthPopupDirector', () => {
  it('routes page actions to the pane while no popup exists', async () => {
    const { pane, popup, director } = harness()
    const routed = director.route(pane)
    expect(await routed.readPage()).toBe('page of pane')
    expect(await routed.click(1)).toBe('clicked by pane')
    expect(routed.state()).toEqual({ url: 'https://pane.example/', title: 'pane' })
    expect(popup.calls).toEqual([])
  })

  it('routes page actions to the popup while one is open, marking readPage', async () => {
    const { pane, director, openPopup } = harness()
    const routed = director.route(pane)
    await openPopup('https://accounts.google.com/signin')
    expect(await routed.readPage()).toBe('page of popup\nauth popup open: https://accounts.google.com/signin')
    expect(await routed.click(1)).toBe('clicked by popup')
    // Navigation verbs and state stay pane-owned.
    expect(await routed.navigate('https://x.example/')).toBe('navigated by pane')
    expect(routed.state().url).toBe('https://pane.example/')
    expect(pane.calls).toContain('navigate')
  })

  it('restores the pane when the popup closes', async () => {
    const { pane, popup, director, openPopup, popups } = harness()
    const routed = director.route(pane)
    await openPopup('https://accounts.google.com/signin')
    expect(await routed.readPage()).toContain('page of popup')
    popups[0].close()
    expect(await routed.readPage()).toBe('page of pane')
    expect(popup.calls).toContain('readPage')
  })

  it('targets the newest popup and falls back when it closes', async () => {
    const { director, openPopup, popups } = harness()
    const routed = director.route(fakeController('pane'))
    await openPopup('https://accounts.google.com/first')
    await openPopup('https://accounts.google.com/second')
    expect(await routed.readPage()).toContain('auth popup open: https://accounts.google.com/second')
    popups[1].close()
    expect(await routed.readPage()).toContain('auth popup open: https://accounts.google.com/first')
    popups[0].close()
    expect(await routed.readPage()).toBe('page of pane')
  })

  it('skips a popup whose webContents is already destroyed', async () => {
    const { pane, popup, director, openPopup } = harness()
    const routed = director.route(pane)
    await openPopup('https://accounts.google.com/signin', true)
    expect(await routed.readPage()).toBe('page of pane')
    expect(popup.calls).toEqual([])
  })
})
