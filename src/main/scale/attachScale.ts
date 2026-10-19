import { ipcMain } from 'electron'
import { WEIGHT_IPC, type ScaleStatus } from '../../core/scale/ipcChannels'
import { createScaleSession, type ScaleSession } from '../../core/scale/scaleSession'
import { createWeighInPopup } from '../../core/scale/weighInPopup'
import { reportFault } from '../../core/trace/fault'
import type { SettingsStore } from '../settings/settingsStore'
import type { ScaleConnection, ScaleTransport } from './bluezScale'
import type { WeighInStore } from './weighInStore'

/** A connected scale that sends nothing for this long has been left: the link is dropped so the next stepping-on connects afresh. */
const QUIET_MS = 15_000

/** The address the e2e stand-in connects as: never remembered. */
const STAND_IN_ADDRESS = '00:00:00:00:00:00'

export interface ScaleListener {
  /** A renderer (the dashboard, the overlay) that hears the Weigh-ins, the pop-up and the status. */
  addReceiver(contents: Electron.WebContents): void
  stop(): void
}

/**
 * The Scale Listener (CONTEXT.md): runs while Bing Bong does. Each
 * connection the transport makes is a scale session (core/scale) — its
 * replies written back in order, its readings driving the Weigh-in pop-up,
 * its Weigh-in added to weighins.json and sent to the renderers. The first
 * scale it connects to is remembered by address in settings; a scale
 * quiet for 15 s is let go. Nothing here speaks.
 */
export function attachScaleListener(deps: { transport: ScaleTransport; store: WeighInStore; settings: SettingsStore }): ScaleListener {
  const receivers = new Set<Electron.WebContents>()
  const send = (channel: string, payload: unknown): void => {
    for (const contents of receivers) if (!contents.isDestroyed()) contents.send(channel, payload)
  }
  let status: ScaleStatus = { state: 'searching', detail: '' }
  const popup = createWeighInPopup((state) => send(WEIGHT_IPC.popupChanged, state))

  let connection: ScaleConnection | null = null
  let session: ScaleSession | null = null
  let quiet: ReturnType<typeof setTimeout> | null = null
  // The replies go out one at a time, in the order the frames asked for them.
  let writing: Promise<void> = Promise.resolve()

  const listen = (): void => {
    if (quiet !== null) clearTimeout(quiet)
    quiet = setTimeout(() => void connection?.disconnect(), QUIET_MS)
  }

  const stop = deps.transport({
    status(next) {
      status = next
      send(WEIGHT_IPC.statusChanged, status)
    },
    remembered: () => deps.settings.get().scale.address,
    connected(address, link) {
      connection = link
      session = createScaleSession()
      listen()
      const settings = deps.settings.get()
      if (settings.scale.address === '' && address !== STAND_IN_ADDRESS) deps.settings.update({ ...settings, scale: { address } })
    },
    frame(bytes) {
      if (session === null || connection === null) return
      listen()
      const link = connection
      const step = session.receive(bytes, Date.now())
      for (const write of step.writes) {
        writing = writing.then(() => link.write(write.characteristic, write.bytes)).catch((error: unknown) => reportFault('scale.write', error))
      }
      if (step.reading !== null) popup.reading(step.reading)
      if (step.weighIn !== null) {
        const previous = deps.store.list().at(-1) ?? null
        send(WEIGHT_IPC.changed, deps.store.add(step.weighIn))
        popup.weighIn(step.weighIn, previous)
      }
    },
    disconnected() {
      if (quiet !== null) clearTimeout(quiet)
      quiet = null
      connection = null
      session = null
      popup.ended()
    },
  })

  ipcMain.handle(WEIGHT_IPC.list, () => deps.store.list())
  ipcMain.handle(WEIGHT_IPC.remove, (_event, at: unknown) => {
    if (typeof at !== 'number') return deps.store.list()
    const weighIns = deps.store.remove(at)
    send(WEIGHT_IPC.changed, weighIns)
    return weighIns
  })
  ipcMain.handle(WEIGHT_IPC.popup, () => popup.state())
  ipcMain.handle(WEIGHT_IPC.status, () => status)

  return {
    addReceiver(contents) {
      receivers.add(contents)
      contents.once('destroyed', () => receivers.delete(contents))
    },
    stop() {
      if (quiet !== null) clearTimeout(quiet)
      stop()
    },
  }
}
