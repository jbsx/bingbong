import { EventEmitter } from 'node:events'
import * as dbus from 'dbus-next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import type { ScaleStatus } from '../../core/scale/ipcChannels'
import { createBluezScaleTransport, type ScaleConnection, type ScaleSessionRecord, type ScaleTransportEvents } from './bluezScale'

// A fake BlueZ on a fake system bus: enough of org.bluez for the listener to
// find an adapter, follow a scale's adverts, connect and stream. A method can
// be made to hang, and the daemon can restart or lose its adapter.

const uuid = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`
const ADAPTER_PATH = '/org/bluez/hci0'
const DEVICE_PATH = `${ADAPTER_PATH}/dev_A4_C1_38_F7_C6_58`
const ADDRESS = 'A4:C1:38:F7:C6:58'

type Props = Record<string, dbus.Variant>

class FakeBluez {
  readonly calls: string[] = []
  readonly hanging = new Set<string>()
  /** Errors a method gives, one per call, before it answers again: what BlueZ says when the link fails. */
  readonly failing = new Map<string, string[]>()
  discovering = false
  private objects: Record<string, Record<string, Props>> = {}
  private readonly ifaces = new Map<string, EventEmitter & Record<string, unknown>>()
  private pending: ((error: Error) => void)[] = []

  constructor() {
    this.addAdapter()
  }

  readonly bus = Object.assign(new EventEmitter(), {
    getProxyObject: async (_name: string, path: string) => ({ getInterface: (name: string) => this.iface(path, name) }),
    disconnect: () => undefined,
  }) as unknown as dbus.MessageBus

  addAdapter(): void {
    this.objects[ADAPTER_PATH] = { 'org.bluez.Adapter1': { Powered: new dbus.Variant('b', true), Discovering: new dbus.Variant('b', false) } }
  }

  /** The scale's first advert: BlueZ makes its object. */
  advertiseNew(): void {
    const device = {
      Address: new dbus.Variant('s', ADDRESS),
      Name: new dbus.Variant('s', 'QN-Scale'),
      UUIDs: new dbus.Variant('as', [uuid('ffe0')]),
      RSSI: new dbus.Variant('n', -70),
    }
    this.objects[DEVICE_PATH] = { 'org.bluez.Device1': device }
    this.iface('/', 'org.freedesktop.DBus.ObjectManager').emit('InterfacesAdded', DEVICE_PATH, { 'org.bluez.Device1': device })
  }

  /** A further advert from the known scale: its RSSI moves. */
  advertise(): void {
    this.iface(DEVICE_PATH, 'org.freedesktop.DBus.Properties').emit('PropertiesChanged', 'org.bluez.Device1', { RSSI: new dbus.Variant('n', -72) })
  }

  /** bluetoothd restarts: its waiting calls fail as dbus-broker fails them, and it comes back with no devices. */
  restart(): void {
    for (const reject of this.pending) reject(new Error('Remote peer disconnected'))
    this.pending = []
    this.discovering = false
    this.objects = {}
    this.addAdapter()
    this.iface('/org/freedesktop/DBus', 'org.freedesktop.DBus').emit('NameOwnerChanged', 'org.bluez', ':1.10', ':1.99')
  }

  /** The adapter is unplugged; BlueZ drops it and its devices. */
  unplug(): void {
    this.discovering = false
    this.objects = {}
    const manager = this.iface('/', 'org.freedesktop.DBus.ObjectManager')
    manager.emit('InterfacesRemoved', DEVICE_PATH, ['org.bluez.Device1'])
    manager.emit('InterfacesRemoved', ADAPTER_PATH, ['org.bluez.Adapter1'])
  }

  plug(): void {
    this.addAdapter()
    this.iface('/', 'org.freedesktop.DBus.ObjectManager').emit('InterfacesAdded', ADAPTER_PATH, this.objects[ADAPTER_PATH])
  }

  /** The scale notifies a frame on one of its characteristics. */
  frame(short: string, hex: string): void {
    this.iface(`${DEVICE_PATH}/service000c/char_${short}`, 'org.freedesktop.DBus.Properties').emit('PropertiesChanged', 'org.bluez.GattCharacteristic1', {
      Value: new dbus.Variant('ay', Buffer.from(hex, 'hex')),
    })
  }

  /** The link drops from the scale's side. */
  drop(): void {
    this.iface(DEVICE_PATH, 'org.freedesktop.DBus.Properties').emit('PropertiesChanged', 'org.bluez.Device1', { Connected: new dbus.Variant('b', false) })
  }

  connects(): number {
    return this.calls.filter((call) => call === 'Connect').length
  }

  private answer<T>(name: string, value: () => T): Promise<T> {
    this.calls.push(name)
    const failure = this.failing.get(name)?.shift()
    if (failure !== undefined) return Promise.reject(new Error(failure))
    if (this.hanging.has(name)) return new Promise<T>((_resolve, reject) => void this.pending.push(reject))
    return Promise.resolve().then(value)
  }

  private iface(path: string, name: string): EventEmitter & Record<string, unknown> {
    const key = `${path} ${name}`
    const existing = this.ifaces.get(key)
    if (existing !== undefined) return existing
    const iface = new EventEmitter() as EventEmitter & Record<string, unknown>
    Object.assign(iface, this.methods(path, name))
    this.ifaces.set(key, iface)
    return iface
  }

  private methods(path: string, name: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
    switch (name) {
      case 'org.freedesktop.DBus.ObjectManager':
        return { GetManagedObjects: () => this.answer('GetManagedObjects', () => structuredClone(this.objects)) }
      case 'org.bluez.Adapter1':
        return {
          SetDiscoveryFilter: () => this.answer('SetDiscoveryFilter', () => undefined),
          StartDiscovery: () => this.answer('StartDiscovery', () => void (this.discovering = true)),
          StopDiscovery: () => this.answer('StopDiscovery', () => void (this.discovering = false)),
        }
      case 'org.bluez.Device1':
        return {
          Connect: () =>
            this.answer('Connect', () => {
              for (const short of ['ffe1', 'ffe2', 'ffe3', 'ffe4']) {
                this.objects[`${path}/service000c/char_${short}`] = { 'org.bluez.GattCharacteristic1': { UUID: new dbus.Variant('s', uuid(short)) } }
              }
            }),
          Disconnect: () => this.answer('Disconnect', () => undefined),
        }
      case 'org.freedesktop.DBus.Properties':
        return { Get: () => this.answer('Get', () => new dbus.Variant('b', true)) }
      case 'org.bluez.GattCharacteristic1':
        return {
          StartNotify: () => this.answer('StartNotify', () => undefined),
          WriteValue: () => this.answer('WriteValue', () => undefined),
        }
      default:
        return {}
    }
  }
}

function listen(bluez: FakeBluez) {
  const statuses: ScaleStatus[] = []
  const connected: string[] = []
  const records: ScaleSessionRecord[] = []
  let link: ScaleConnection | null = null
  let disconnected = 0
  const events: ScaleTransportEvents = {
    status: (status) => void statuses.push(status),
    remembered: () => '',
    connected: (address, connection) => {
      connected.push(address)
      link = connection
    },
    frame: () => undefined,
    disconnected: () => void disconnected++,
  }
  const stop = createBluezScaleTransport({ systemBus: () => bluez.bus, log: (record) => void records.push(record) })(events)
  return { statuses, connected, records, link: () => link, disconnected: () => disconnected, stop, last: () => statuses.at(-1) }
}

/** Long enough for the scale to sleep and wake, so the next advert is a new stepping-on. */
const ASLEEP = 15_000

describe('the BlueZ Scale Listener always recovers (#556)', () => {
  const faults: FaultReport[] = []
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    faults.length = 0
    setFaultSink((report) => void faults.push(report))
  })
  afterEach(() => {
    setFaultSink(null)
    vi.useRealTimers()
  })

  it('a Connect BlueZ never answers ends the session as a fault naming it, and the next advert connects', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.discovering).toBe(true)

    bluez.hanging.add('Connect')
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.connects()).toBe(1)
    expect(bluez.discovering).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(faults.find((fault) => fault.site === 'scale.bluez.session')?.message).toMatch(/^Connect timed out after \d+ s$/)
    expect(bluez.calls).toContain('Disconnect')
    expect(bluez.discovering).toBe(true)
    expect(scale.last()).toEqual({ state: 'searching', detail: '' })

    bluez.hanging.delete('Connect')
    bluez.advertise()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS])
    scale.stop()
  })

  it.each(['GetManagedObjects', 'StartNotify', 'Get'])('a %s BlueZ never answers mid-session ends it as a fault naming it', async (call) => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.hanging.add(call)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(faults.find((fault) => fault.site === 'scale.bluez.session')?.message).toMatch(new RegExp(`^${call}( \\w+)? timed out after \\d+ s$`))

    // A BlueZ that still hangs fails the re-arm too; the listener's own retry brings discovery back.
    bluez.hanging.delete(call)
    await vi.advanceTimersByTimeAsync(60_000 + ASLEEP)
    expect(bluez.discovering).toBe(true)
    bluez.advertise()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected.at(-1)).toBe(ADDRESS)
    scale.stop()
  })

  it('a BlueZ restart while connected ends the session and restarts the listener, which connects to the next advert', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS])

    bluez.restart()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.disconnected()).toBe(1)
    expect(bluez.discovering).toBe(true)
    expect(scale.last()).toEqual({ state: 'searching', detail: '' })

    await vi.advanceTimersByTimeAsync(ASLEEP)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS, ADDRESS])
    scale.stop()
  })

  it('a BlueZ restart while a call hangs ends that session at once, without waiting out its limit', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.hanging.add('Connect')
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)

    bluez.hanging.delete('Connect')
    bluez.restart()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.disconnected()).toBe(1)
    expect(bluez.discovering).toBe(true)

    await vi.advanceTimersByTimeAsync(ASLEEP)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS])
    scale.stop()
  })

  it('an adapter removed is dropped, and plugged back in starts the listener, which connects to the next advert', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS])

    bluez.unplug()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.disconnected()).toBe(1)
    expect(scale.last()).toEqual({ state: 'unavailable', detail: 'Bluetooth unavailable: no adapter' })

    bluez.plug()
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.discovering).toBe(true)
    expect(scale.last()).toEqual({ state: 'searching', detail: '' })

    await vi.advanceTimersByTimeAsync(ASLEEP)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.connected).toEqual([ADDRESS, ADDRESS])
    scale.stop()
  })
})

const ABORT = 'le-connection-abort-by-local'

describe('the BlueZ Scale Listener connects in the scale\'s awake window, and records every session (#560)', () => {
  const faults: FaultReport[] = []
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    faults.length = 0
    setFaultSink((report) => void faults.push(report))
  })
  afterEach(() => {
    setFaultSink(null)
    vi.useRealTimers()
  })

  it('a Connect aborted on the local side is tried again at once, without waiting for another advert', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.failing.set('Connect', [ABORT, ABORT])
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.connects()).toBe(3)
    expect(scale.connected).toEqual([ADDRESS])
    expect(faults.filter((fault) => fault.site === 'scale.bluez.session')).toEqual([])
    scale.stop()
  })

  it('a link the scale drops while Connect is being tried again does not end the session', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.failing.set('Connect', [ABORT])
    bluez.hanging.add('Connect')
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    // The first attempt failed; the second waits on the radio while BlueZ reports the half-made link gone.
    bluez.drop()
    bluez.hanging.delete('Connect')
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.disconnected()).toBe(0)
    scale.stop()
  })

  it('three aborted Connects end the session as one fault, and each attempt is recorded', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.failing.set('Connect', [ABORT, ABORT, ABORT, ABORT])
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.connects()).toBe(3)
    expect(scale.connected).toEqual([])
    expect(faults.filter((fault) => fault.site === 'scale.bluez.session').map((fault) => fault.message)).toEqual([ABORT])
    expect(scale.records).toHaveLength(1)
    expect(scale.records[0]).toMatchObject({ address: ADDRESS, end: 'failed', error: ABORT, connectedAt: null, resolvedAt: null, frames: [] })
    expect(scale.records[0].attempts.map((attempt) => attempt.error)).toEqual([ABORT, ABORT, ABORT])
    scale.stop()
  })

  it('any other Connect failure is not tried again', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.failing.set('Connect', ['Operation already in progress'])
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    expect(bluez.connects()).toBe(1)
    expect(scale.records[0]).toMatchObject({ end: 'failed', error: 'Operation already in progress' })
    scale.stop()
  })

  it('a session let go by the listener records when the scale woke, the link, its frames and the end', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    const woke = Date.now()
    bluez.failing.set('Connect', [ABORT])
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    bluez.frame('ffe1', '12112001')
    await vi.advanceTimersByTimeAsync(500)
    bluez.frame('ffe1', '100b20209e')
    await scale.link()!.disconnect()
    bluez.drop()
    await vi.advanceTimersByTimeAsync(0)

    expect(scale.records).toHaveLength(1)
    const [record] = scale.records
    expect(record).toMatchObject({ address: ADDRESS, wokeAt: woke, startedAt: woke, end: 'let go' })
    expect(record.attempts.map((attempt) => attempt.error)).toEqual([ABORT, undefined])
    expect(record.connectedAt).not.toBeNull()
    expect(record.resolvedAt).not.toBeNull()
    expect(record.frames).toEqual([
      { at: woke + 1_000, hex: '12112001' },
      { at: woke + 1_500, hex: '100b20209e' },
    ])
    expect(record.endedAt).toBe(woke + 1_500)
    expect(record.error).toBeUndefined()
    scale.stop()
  })

  it('a link the scale drops is recorded as dropped, and the wake time is not reset by the adverts after it', async () => {
    const bluez = new FakeBluez()
    const scale = listen(bluez)
    await vi.advanceTimersByTimeAsync(0)
    bluez.advertiseNew()
    await vi.advanceTimersByTimeAsync(0)
    bluez.drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.records.at(-1)).toMatchObject({ end: 'dropped', frames: [] })

    // The scale sleeps and is stepped on again: a new wake.
    await vi.advanceTimersByTimeAsync(ASLEEP)
    const woke = Date.now()
    bluez.advertise()
    await vi.advanceTimersByTimeAsync(0)
    bluez.drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(scale.records).toHaveLength(2)
    expect(scale.records[1]).toMatchObject({ wokeAt: woke, startedAt: woke, end: 'dropped' })
    scale.stop()
  })
})
