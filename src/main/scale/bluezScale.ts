import * as dbus from 'dbus-next'
import type { QnCharacteristic } from '../../core/scale/qn'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import { CallLimitError, withinLimit } from '../../core/scale/callLimit'
import { createWakeGate } from '../../core/scale/wakeGate'
import { reportFault } from '../../core/trace/fault'
import { waitForServices } from './servicesWait'

// The Scale Listener's Bluetooth (CONTEXT.md): BlueZ over the system D-Bus
// with a pure-JS client (dbus-next) — no native module, no root, no Python.
// Discovery is filtered to LE adverts of the QN service; a QN-family advert
// (or, once one is remembered, only that address's) is connected, its GATT
// characteristics found, and ffe1/ffe2's notifications handed up as frames.
// Everything about the protocol lives in core/scale; this is the transport.

/** One live connection to the scale. */
export interface ScaleConnection {
  write(characteristic: QnCharacteristic, bytes: Uint8Array): Promise<void>
  disconnect(): Promise<void>
}

export interface ScaleTransportEvents {
  status(status: ScaleStatus): void
  /** The remembered scale's address, or '' to take the first QN-family scale seen. */
  remembered(): string
  connected(address: string, connection: ScaleConnection): void
  frame(bytes: Uint8Array): void
  disconnected(): void
}

/** Starts listening; the returned function stops it. */
export type ScaleTransport = (events: ScaleTransportEvents) => () => void

const BLUEZ = 'org.bluez'
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager'
const PROPERTIES = 'org.freedesktop.DBus.Properties'
const ADAPTER = 'org.bluez.Adapter1'
const DEVICE = 'org.bluez.Device1'
const CHARACTERISTIC = 'org.bluez.GattCharacteristic1'

const uuid = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`
const QN_SERVICE = uuid('ffe0')
const NOTIFY = [uuid('ffe1'), uuid('ffe2')]

/** The names a QN-family scale advertises. */
const QN_NAME = /qn-scale|renpho-scale/i

/** How long the services may take to resolve after Connect returns. */
const RESOLVE_MS = 10_000
// Every awaited BlueZ call has a limit (#556): dbus-next sets none, and on the
// kiosk one call BlueZ never answered held the listener for days.
/**
 * Calls BlueZ answers from its own state (the object fetch, introspection,
 * a property, the discovery switches): they answer in milliseconds, so this
 * is a guess with room for a loaded i3 and a busy daemon, not a measure.
 */
const LOCAL_CALL_MS = 10_000
/**
 * Calls that wait on the radio. Connect at range ends in the kernel's own
 * give-up, `le-connection-abort-by-local`, after its LE connection timeout
 * (HCI_LE_CONN_TIMEOUT, 20 s); StartNotify and WriteValue are one ATT
 * request each, which BlueZ gives up after the ATT transaction timeout of
 * 30 s. The limit sits above both, so a slow link fails with BlueZ's own
 * error and only a call BlueZ never answers meets it.
 */
const AIR_CALL_MS = 35_000
/** How long between connection attempts to the same advert, so a scale that refuses is not hammered. */
const RETRY_CONNECT_MS = 3_000
/** How often an unavailable Bluetooth is tried again, beside the adapter and service appearing. */
const RETRY_UNAVAILABLE_MS = 60_000

type Props = Record<string, dbus.Variant>
type Objects = Record<string, Record<string, Props>>

function value<T>(props: Props | undefined, key: string): T | undefined {
  return props?.[key]?.value as T | undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The settings line for a Bluetooth that cannot be used, whole: each says what is wrong. */
function unavailableDetail(error: unknown): string {
  const text = message(error)
  if (/ServiceUnknown|org\.bluez was not provided/i.test(text)) return 'Bluetooth unavailable: the BlueZ service is not running'
  if (/No Bluetooth adapter/.test(text)) return 'Bluetooth unavailable: no adapter'
  if (/NotSupported|InvalidArguments/i.test(text)) return 'Bluetooth unavailable: LE is off on the adapter (BlueZ ControllerMode)'
  if (/NotReady|Powered/i.test(text)) return 'Bluetooth unavailable: the adapter is turned off'
  if (/AccessDenied/i.test(text)) return 'Bluetooth unavailable: access denied on the system bus'
  return `Bluetooth unavailable: ${text}`
}

export interface BluezScaleOptions {
  /** The system bus; a test hands in a fake BlueZ. */
  readonly systemBus?: () => dbus.MessageBus
}

export function createBluezScaleTransport(options: BluezScaleOptions = {}): ScaleTransport {
  const systemBus = options.systemBus ?? (() => dbus.systemBus())
  return (events) => {
    let stopped = false
    let bus: dbus.MessageBus | null = null
    let adapterPath: string | null = null
    let adapter: dbus.ClientInterface | null = null
    let busy = false
    /** Ends the session under way, if any: the link dropped, the bus failed, or the listener stopped. */
    let endSession: () => void = () => undefined
    let starting = false
    let connected: ScaleConnection | null = null
    let lastAttempt = 0
    let lastFault = ''
    let retry: ReturnType<typeof setTimeout> | null = null
    // A scale let go is not connected again until it has slept (core/scale/wakeGate).
    const wake = createWakeGate()
    const watched = new Map<string, () => void>()

    const status = (next: ScaleStatus): void => {
      if (next.state === 'unavailable' && next.detail !== lastFault) {
        lastFault = next.detail
        reportFault('scale.bluez', new Error(next.detail))
      }
      if (next.state !== 'unavailable') lastFault = ''
      events.status(next)
    }

    const fail = (error: unknown): void => {
      status({ state: 'unavailable', detail: unavailableDetail(error) })
      adapter = null
      adapterPath = null
      if (retry === null && !stopped) {
        retry = setTimeout(() => {
          retry = null
          void start()
        }, RETRY_UNAVAILABLE_MS)
      }
    }

    /** A BlueZ object's proxy: dbus-next introspects it, which is a call of its own. */
    const proxyFor = (path: string, abandoned?: Promise<unknown>): Promise<dbus.ProxyObject> =>
      withinLimit(bus!.getProxyObject(BLUEZ, path), `Introspect ${path}`, LOCAL_CALL_MS, abandoned)

    const objects = async (abandoned?: Promise<unknown>): Promise<Objects> => {
      const root = await proxyFor('/', abandoned)
      return (await withinLimit(root.getInterface(OBJECT_MANAGER).GetManagedObjects(), 'GetManagedObjects', LOCAL_CALL_MS, abandoned)) as Objects
    }

    const discover = async (): Promise<void> => {
      if (adapter === null) return
      const held = adapter
      await withinLimit(
        held.SetDiscoveryFilter({ Transport: new dbus.Variant('s', 'le'), UUIDs: new dbus.Variant('as', [QN_SERVICE]), DuplicateData: new dbus.Variant('b', true) }),
        'SetDiscoveryFilter',
        LOCAL_CALL_MS,
      )
      const props = (await objects())[adapterPath!]?.[ADAPTER]
      if (value<boolean>(props, 'Discovering') !== true) await withinLimit(held.StartDiscovery(), 'StartDiscovery', LOCAL_CALL_MS)
    }

    const isScale = (address: string | undefined, props: Props | undefined): boolean => {
      if (address === undefined) return false
      const remembered = events.remembered()
      if (remembered !== '') return address.toUpperCase() === remembered
      const name = value<string>(props, 'Name') ?? value<string>(props, 'Alias') ?? ''
      const uuids = value<string[]>(props, 'UUIDs') ?? []
      return QN_NAME.test(name) && uuids.includes(QN_SERVICE)
    }

    /** One session: connect, find the characteristics, stream notifications until the link drops. */
    const session = async (path: string, address: string): Promise<void> => {
      busy = true
      lastAttempt = Date.now()
      const cleanups: (() => void)[] = []
      let reached = false
      let device: dbus.ClientInterface | null = null
      // The session's end also abandons any call it is waiting on, so a BlueZ restart or a lost adapter ends it at once.
      let ended: () => void = () => undefined
      const over = new Promise<void>((resolve) => (ended = resolve))
      endSession = ended
      const disconnect = async (): Promise<void> => {
        if (device === null) return
        await withinLimit(device.Disconnect(), 'Disconnect', AIR_CALL_MS).catch((error: unknown) => reportFault('scale.bluez.disconnect', error))
      }
      try {
        // Discovery may already be off; the connection goes ahead either way.
        if (adapter !== null) await withinLimit(adapter.StopDiscovery(), 'StopDiscovery', LOCAL_CALL_MS, over).catch((error: unknown) => reportFault('scale.bluez.stopDiscovery', error))
        const proxy = await proxyFor(path, over)
        device = proxy.getInterface(DEVICE)
        const deviceProps = proxy.getInterface(PROPERTIES)
        const onDevice = (iface: string, changed: Props): void => {
          if (iface === DEVICE && value<boolean>(changed, 'Connected') === false) ended()
        }
        deviceProps.on('PropertiesChanged', onDevice)
        cleanups.push(() => deviceProps.removeListener('PropertiesChanged', onDevice))
        await withinLimit(device.Connect(), 'Connect', AIR_CALL_MS, over)
        // A drop mid-resolve ends the session at once (#397).
        const resolved = async (): Promise<boolean> =>
          (await withinLimit<dbus.Variant>(deviceProps.Get(DEVICE, 'ServicesResolved'), 'Get ServicesResolved', LOCAL_CALL_MS, over)).value === true
        await waitForServices(resolved, over, { timeoutMs: RESOLVE_MS })
        const all = await objects(over)
        const characteristics = new Map<string, string>()
        for (const [charPath, ifaces] of Object.entries(all)) {
          const char = ifaces[CHARACTERISTIC]
          if (charPath.startsWith(`${path}/`) && char !== undefined) characteristics.set(value<string>(char, 'UUID') ?? '', charPath)
        }
        const writer = async (short: QnCharacteristic): Promise<dbus.ClientInterface> => {
          const charPath = characteristics.get(uuid(short))
          if (charPath === undefined) throw new Error(`the scale has no ${short}`)
          return (await proxyFor(charPath, over)).getInterface(CHARACTERISTIC)
        }
        const writers = { ffe3: await writer('ffe3'), ffe4: await writer('ffe4') }
        const connection: ScaleConnection = {
          write: async (characteristic, bytes) => {
            await withinLimit(writers[characteristic].WriteValue(Buffer.from(bytes), { type: new dbus.Variant('s', 'request') }), `WriteValue ${characteristic}`, AIR_CALL_MS, over)
          },
          disconnect,
        }
        // The session exists before notifications start: the scale sends its info frame at once, and it must be answered.
        connected = connection
        reached = true
        status({ state: 'connected', detail: address })
        events.connected(address, connection)
        for (const notifyUuid of NOTIFY) {
          const charPath = characteristics.get(notifyUuid)
          if (charPath === undefined) continue
          const proxyChar = await proxyFor(charPath, over)
          const charProps = proxyChar.getInterface(PROPERTIES)
          const onValue = (iface: string, changed: Props): void => {
            const bytes = value<Buffer>(changed, 'Value')
            if (iface === CHARACTERISTIC && bytes !== undefined) events.frame(new Uint8Array(bytes))
          }
          charProps.on('PropertiesChanged', onValue)
          cleanups.push(() => charProps.removeListener('PropertiesChanged', onValue))
          // ffe2 only indicates acknowledgements; a scale without it still weighs. A call that hangs ends the session all the same.
          await withinLimit(proxyChar.getInterface(CHARACTERISTIC).StartNotify(), 'StartNotify', AIR_CALL_MS, over).catch((error: unknown) => {
            if (error instanceof CallLimitError) throw error
            reportFault('scale.bluez.startNotify', error)
          })
        }
        await over
      } catch (error) {
        // A stop ends the session too; only a link that failed on its own is a fault.
        if (!stopped) reportFault('scale.bluez.session', error)
        await disconnect()
      } finally {
        for (const cleanup of cleanups) cleanup()
        busy = false
        connected = null
        endSession = () => undefined
        if (reached) wake.hold(address, Date.now())
        events.disconnected()
        if (!stopped && adapter !== null) {
          status({ state: 'searching', detail: '' })
          await discover().catch(fail)
        }
      }
    }

    /** An advert (or a property change) from a device: connect when it is the scale and nothing else is under way. */
    const seen = (path: string, props: Props | undefined): void => {
      const address = value<string>(props, 'Address')
      if (stopped || !isScale(address, props)) return
      const now = Date.now()
      if (!wake.heard(address!.toUpperCase(), now) || busy || now - lastAttempt < RETRY_CONNECT_MS) return
      void session(path, address!.toUpperCase())
    }

    /** Follow a device's adverts: with DuplicateData each one moves its RSSI. */
    const watch = async (path: string, initial: Props): Promise<void> => {
      if (watched.has(path)) return
      const props = (await proxyFor(path)).getInterface(PROPERTIES)
      let known: Props = { ...initial }
      const onChange = (iface: string, changed: Props): void => {
        if (iface !== DEVICE) return
        known = { ...known, ...changed }
        if ('RSSI' in changed || 'ManufacturerData' in changed) seen(path, known)
      }
      props.on('PropertiesChanged', onChange)
      watched.set(path, () => props.removeListener('PropertiesChanged', onChange))
      if (value<number>(initial, 'RSSI') !== undefined) seen(path, known)
    }

    /** A device worth following: a QN-family name or service, or the remembered address. */
    const candidate = (props: Props): boolean =>
      QN_NAME.test(value<string>(props, 'Name') ?? value<string>(props, 'Alias') ?? '') || (value<string[]>(props, 'UUIDs') ?? []).includes(QN_SERVICE) || isScale(value<string>(props, 'Address'), props)

    let following = false
    /** Let go of the adapter: the session under way ends, and the devices followed through it are let go too. */
    const forgetAdapter = (): void => {
      endSession()
      for (const unwatch of watched.values()) unwatch()
      watched.clear()
      adapter = null
      adapterPath = null
    }

    let startAgain = false
    /** BlueZ or its adapter changed under the listener: begin again from nothing, after any start under way. */
    const restart = (): void => {
      forgetAdapter()
      if (starting) startAgain = true
      else void start()
    }

    /** BlueZ's objects coming and going: an adapter plugged in starts the listener again, the one in use unplugged drops it, a new device is followed. */
    const follow = async (): Promise<void> => {
      if (following) return
      const root = await proxyFor('/')
      following = true
      const manager = root.getInterface(OBJECT_MANAGER)
      manager.on('InterfacesAdded', (path: string, ifaces: Record<string, Props>) => {
        if (ifaces[ADAPTER] !== undefined && adapter === null) void start()
        const device = ifaces[DEVICE]
        if (device !== undefined && adapter !== null && candidate(device)) void watch(path, device).catch((error: unknown) => reportFault('scale.bluez.watch', error))
      })
      // Its proxy would otherwise outlive the adapter, and the listener would wait on a radio that is gone.
      manager.on('InterfacesRemoved', (path: string, ifaces: string[]) => {
        if (path === adapterPath && ifaces.includes(ADAPTER)) restart()
      })
    }

    /** Forget a bus that failed: the devices it followed go with it, and the next start connects afresh. */
    const dropBus = (): void => {
      forgetAdapter()
      following = false
      const old = bus
      bus = null
      old?.disconnect()
    }

    /** The system bus, connected once and kept: its own failure fails the listener, and BlueZ starting starts it again. */
    const connectBus = async (): Promise<dbus.MessageBus> => {
      if (bus !== null) return bus
      const next = systemBus()
      bus = next
      next.on('error', (error: unknown) => {
        if (bus !== next) return
        dropBus()
        fail(error)
      })
      try {
        const dbusProxy = await withinLimit(next.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus'), 'Introspect /org/freedesktop/DBus', LOCAL_CALL_MS)
        // A bluetoothd that went or came back owns none of what the listener holds: an adapter kept
        // across a restart was how the listener sat for days with discovery off (#556).
        dbusProxy.getInterface('org.freedesktop.DBus').on('NameOwnerChanged', (name: string, _old: string, owner: string) => {
          if (name !== BLUEZ) return
          if (owner !== '') restart()
          else if (adapter !== null) {
            forgetAdapter()
            fail(new Error('ServiceUnknown: org.bluez left the bus'))
          }
        })
      } catch (error) {
        if (bus === next) dropBus()
        throw error
      }
      return next
    }

    const start = async (): Promise<void> => {
      // BlueZ appearing and an adapter appearing can both ask at once: one start at a time.
      if (stopped || starting) return
      starting = true
      try {
        const connected = await connectBus()
        const all = await objects()
        await follow()
        const found = Object.entries(all).find(([, ifaces]) => ifaces[ADAPTER] !== undefined)
        if (found === undefined) throw new Error('No Bluetooth adapter')
        adapterPath = found[0]
        if (value<boolean>(found[1][ADAPTER], 'Powered') !== true) throw new Error('Bluetooth NotReady: adapter not Powered')
        adapter = (await withinLimit(connected.getProxyObject(BLUEZ, adapterPath), `Introspect ${adapterPath}`, LOCAL_CALL_MS)).getInterface(ADAPTER)
        await discover()
        status({ state: 'searching', detail: '' })
        for (const [path, ifaces] of Object.entries(all)) {
          const device = ifaces[DEVICE]
          if (device !== undefined && candidate(device)) await watch(path, device)
        }
      } catch (error) {
        fail(error)
      } finally {
        starting = false
        if (startAgain) {
          startAgain = false
          void start()
        }
      }
    }
    void start()

    return () => {
      stopped = true
      if (retry !== null) clearTimeout(retry)
      const scale = connected
      const discovery = adapter
      // A scale still connected is let go before the bus closes, so BlueZ does not hold the link.
      void Promise.all([
        scale?.disconnect(),
        discovery && withinLimit(discovery.StopDiscovery(), 'StopDiscovery', LOCAL_CALL_MS).catch((error: unknown) => reportFault('scale.bluez.stopDiscovery', error)),
      ]).finally(dropBus)
    }
  }
}
