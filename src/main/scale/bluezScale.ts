import * as dbus from 'dbus-next'
import type { QnCharacteristic } from '../../core/scale/qn'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import { reportFault } from '../../core/trace/fault'

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

export function createBluezScaleTransport(): ScaleTransport {
  return (events) => {
    let stopped = false
    let bus: dbus.MessageBus | null = null
    let adapterPath: string | null = null
    let adapter: dbus.ClientInterface | null = null
    let busy = false
    let lastAttempt = 0
    let lastFault = ''
    let retry: ReturnType<typeof setTimeout> | null = null
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

    const objects = async (): Promise<Objects> => {
      const root = await bus!.getProxyObject(BLUEZ, '/')
      return (await root.getInterface(OBJECT_MANAGER).GetManagedObjects()) as Objects
    }

    const discover = async (): Promise<void> => {
      if (adapter === null) return
      await adapter.SetDiscoveryFilter({ Transport: new dbus.Variant('s', 'le'), UUIDs: new dbus.Variant('as', [QN_SERVICE]), DuplicateData: new dbus.Variant('b', true) })
      const props = (await objects())[adapterPath!]?.[ADAPTER]
      if (value<boolean>(props, 'Discovering') !== true) await adapter.StartDiscovery()
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
      let device: dbus.ClientInterface | null = null
      try {
        await adapter?.StopDiscovery().catch(() => undefined)
        const proxy = await bus!.getProxyObject(BLUEZ, path)
        device = proxy.getInterface(DEVICE)
        const deviceProps = proxy.getInterface(PROPERTIES)
        let ended: () => void = () => undefined
        const over = new Promise<void>((resolve) => (ended = resolve))
        const onDevice = (iface: string, changed: Props): void => {
          if (iface === DEVICE && value<boolean>(changed, 'Connected') === false) ended()
        }
        deviceProps.on('PropertiesChanged', onDevice)
        cleanups.push(() => deviceProps.removeListener('PropertiesChanged', onDevice))
        await device.Connect()
        const deadline = Date.now() + RESOLVE_MS
        while ((await deviceProps.Get(DEVICE, 'ServicesResolved')).value !== true) {
          if (Date.now() > deadline) throw new Error('the scale’s services did not resolve')
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        const all = await objects()
        const characteristics = new Map<string, string>()
        for (const [charPath, ifaces] of Object.entries(all)) {
          const char = ifaces[CHARACTERISTIC]
          if (charPath.startsWith(`${path}/`) && char !== undefined) characteristics.set(value<string>(char, 'UUID') ?? '', charPath)
        }
        const writer = async (short: QnCharacteristic): Promise<dbus.ClientInterface> => {
          const charPath = characteristics.get(uuid(short))
          if (charPath === undefined) throw new Error(`the scale has no ${short}`)
          return (await bus!.getProxyObject(BLUEZ, charPath)).getInterface(CHARACTERISTIC)
        }
        const writers = { ffe3: await writer('ffe3'), ffe4: await writer('ffe4') }
        for (const notifyUuid of NOTIFY) {
          const charPath = characteristics.get(notifyUuid)
          if (charPath === undefined) continue
          const proxyChar = await bus!.getProxyObject(BLUEZ, charPath)
          const charProps = proxyChar.getInterface(PROPERTIES)
          const onValue = (iface: string, changed: Props): void => {
            const bytes = value<Buffer>(changed, 'Value')
            if (iface === CHARACTERISTIC && bytes !== undefined) events.frame(new Uint8Array(bytes))
          }
          charProps.on('PropertiesChanged', onValue)
          cleanups.push(() => charProps.removeListener('PropertiesChanged', onValue))
          // ffe2 only indicates acknowledgements; a scale without it still weighs.
          await proxyChar
            .getInterface(CHARACTERISTIC)
            .StartNotify()
            .catch((error: unknown) => reportFault('scale.bluez.startNotify', error))
        }
        const connection: ScaleConnection = {
          write: async (characteristic, bytes) => {
            await writers[characteristic].WriteValue(Buffer.from(bytes), { type: new dbus.Variant('s', 'request') })
          },
          disconnect: async () => {
            await device?.Disconnect().catch((error: unknown) => reportFault('scale.bluez.disconnect', error))
          },
        }
        status({ state: 'connected', detail: address })
        events.connected(address, connection)
        await over
      } catch (error) {
        reportFault('scale.bluez.session', error)
        await device?.Disconnect().catch(() => undefined)
      } finally {
        for (const cleanup of cleanups) cleanup()
        busy = false
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
      if (stopped || busy || !isScale(address, props) || Date.now() - lastAttempt < RETRY_CONNECT_MS) return
      void session(path, address!.toUpperCase())
    }

    /** Follow a device's adverts: with DuplicateData each one moves its RSSI. */
    const watch = async (path: string, initial: Props): Promise<void> => {
      if (watched.has(path)) return
      const props = (await bus!.getProxyObject(BLUEZ, path)).getInterface(PROPERTIES)
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
    /** BlueZ's new objects: an adapter plugged in starts the listener again, a new device is followed. */
    const follow = async (): Promise<void> => {
      if (following) return
      const root = await bus!.getProxyObject(BLUEZ, '/')
      following = true
      root.getInterface(OBJECT_MANAGER).on('InterfacesAdded', (path: string, ifaces: Record<string, Props>) => {
        if (ifaces[ADAPTER] !== undefined && adapter === null) void start()
        const device = ifaces[DEVICE]
        if (device !== undefined && adapter !== null && candidate(device)) void watch(path, device).catch((error: unknown) => reportFault('scale.bluez.watch', error))
      })
    }

    /** Forget a bus that failed: the devices it followed go with it, and the next start connects afresh. */
    const dropBus = (): void => {
      for (const unwatch of watched.values()) unwatch()
      watched.clear()
      following = false
      adapter = null
      adapterPath = null
      const old = bus
      bus = null
      old?.disconnect()
    }

    /** The system bus, connected once and kept: its own failure fails the listener, and BlueZ starting starts it again. */
    const connectBus = async (): Promise<dbus.MessageBus> => {
      if (bus !== null) return bus
      const next = dbus.systemBus()
      bus = next
      next.on('error', (error: unknown) => {
        if (bus !== next) return
        dropBus()
        fail(error)
      })
      try {
        const dbusProxy = await next.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
        dbusProxy.getInterface('org.freedesktop.DBus').on('NameOwnerChanged', (name: string, _old: string, owner: string) => {
          if (name === BLUEZ && owner !== '' && adapter === null) void start()
        })
      } catch (error) {
        if (bus === next) dropBus()
        throw error
      }
      return next
    }

    const start = async (): Promise<void> => {
      if (stopped) return
      try {
        const connected = await connectBus()
        const all = await objects()
        await follow()
        const found = Object.entries(all).find(([, ifaces]) => ifaces[ADAPTER] !== undefined)
        if (found === undefined) throw new Error('No Bluetooth adapter')
        adapterPath = found[0]
        if (value<boolean>(found[1][ADAPTER], 'Powered') !== true) throw new Error('Bluetooth NotReady: adapter not Powered')
        adapter = (await connected.getProxyObject(BLUEZ, adapterPath)).getInterface(ADAPTER)
        await discover()
        status({ state: 'searching', detail: '' })
        for (const [path, ifaces] of Object.entries(all)) {
          const device = ifaces[DEVICE]
          if (device !== undefined && candidate(device)) await watch(path, device)
        }
      } catch (error) {
        fail(error)
      }
    }
    void start()

    return () => {
      stopped = true
      if (retry !== null) clearTimeout(retry)
      for (const unwatch of watched.values()) unwatch()
      void adapter?.StopDiscovery()
        .catch(() => undefined)
        .finally(dropBus)
      if (adapter === null) dropBus()
    }
  }
}
