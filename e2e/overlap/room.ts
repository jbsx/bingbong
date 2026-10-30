// The room an echo case runs in (#490): a private PulseAudio server whose one
// device is a null sink, so the app's own voice reaches the microphone the way
// it does in a living room, live, and nothing reaches a speaker. The app plays
// its speech into the sink (aplay through the pulse plugin), the person's
// lines are played into the same sink, and the app's microphone is the sink's
// monitor, remapped as a source of its own (Chromium takes no sink's monitor
// as its default microphone): the mix of both, the app's voice ducking and
// stopping as it does.
//
// It is fail-closed: the server loads no device module, only the null sink
// its own socket and the source over its monitor, and is checked for exactly that before a run uses it;
// a player that cannot reach it plays nowhere, never on the default device.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

export interface Room {
  /** The server's address, for PULSE_SERVER. */
  readonly server: string
  /** An aplay that plays into the room only: BINGBONG_APLAY_BIN for the app. */
  readonly aplay: string
  /** Plays a wav into the room from now. */
  play(wav: string): void
  /** Records what the microphone hears from now to close, into `path`. */
  record(path: string): void
  close(): Promise<void>
}

const SINK = 'room'
/** The microphone: the sink's monitor as a source that is not a monitor. */
const MIC = 'mic'
/** The only modules a room may hold: its socket, its null sink and the microphone over its monitor. */
const ALLOWED_MODULES = new Set(['module-native-protocol-unix', 'module-null-sink', 'module-remap-source'])

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** What the room's server holds, read over its own socket: why it is not a closed room, or null. */
export function roomLeaks(modules: string, sinks: string, allowed: readonly string[] = [SINK]): string | null {
  for (const line of modules.split('\n').filter((row) => row.trim() !== '')) {
    const name = line.split('\t')[1] ?? ''
    if (!ALLOWED_MODULES.has(name)) return `the room loaded ${name}`
  }
  const rows = sinks.split('\n').filter((row) => row.trim() !== '')
  if (rows.length !== allowed.length) return `the room has ${rows.length} sinks`
  for (const row of rows) {
    const [, name, driver] = row.split('\t')
    if (!allowed.includes(name!) || driver !== 'module-null-sink.c') return `the room's sink is ${name} on ${driver}`
  }
  return null
}

/** A kiosk replay's room (#515): the reference plays into `REPLAY_REFERENCE_SINK`, which no mic hears, and the take's raw mic into `REPLAY_AIR_SINK`, whose monitor is the mic. Closed as `openRoom`'s is. */
export const REPLAY_REFERENCE_SINK = 'spk'
export const REPLAY_AIR_SINK = 'air'

export async function openReplayRoom(dir: string): Promise<{ readonly server: string; close(): Promise<void> }> {
  const room = await startRoom(dir, [`module-null-sink sink_name=${REPLAY_REFERENCE_SINK} rate=48000 channels=2`, `module-null-sink sink_name=${REPLAY_AIR_SINK} rate=48000 channels=1`, `module-remap-source master=${REPLAY_AIR_SINK}.monitor source_name=${MIC} channels=1`], REPLAY_REFERENCE_SINK, [REPLAY_REFERENCE_SINK, REPLAY_AIR_SINK])
  return { server: room.server, close: room.close }
}

async function startRoom(dir: string, modules: readonly string[], defaultSink: string, sinks: readonly string[]): Promise<{ readonly server: string; readonly children: ChildProcess[]; close(): Promise<void> }> {
  mkdirSync(join(dir, 'run'), { recursive: true })
  mkdirSync(join(dir, 'state'), { recursive: true })
  const socket = join(dir, 'native')
  const server = `unix:${socket}`
  const daemon = spawn(
    'pulseaudio',
    ['-n', '--daemonize=no', '--exit-idle-time=-1', '--use-pid-file=no', '--system=no', '--disable-shm=yes', '--log-target=stderr', '-L', `module-native-protocol-unix socket=${socket} auth-anonymous=1`, ...modules.flatMap((module) => ['-L', module])],
    // Off the session bus: a room's daemon claims org.PulseAudio1 there, and a second room beside a live one (the
    // capture slot is three runs) exits on the name already taken, so no two rooms could be up at once (#494).
    { env: { ...process.env, PULSE_RUNTIME_PATH: join(dir, 'run'), PULSE_STATE_PATH: join(dir, 'state'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(dir, 'no-bus')}` }, stdio: 'ignore' },
  )
  const children: ChildProcess[] = []
  const pactl = (...args: string[]) => spawnSync('pactl', ['-s', server, ...args], { encoding: 'utf8' })
  const close = async (): Promise<void> => {
    for (const child of children) child.kill('SIGINT')
    await sleep(300)
    daemon.kill()
  }
  for (let tries = 0; !existsSync(socket) || pactl('info').status !== 0; tries++) {
    if (tries > 40 || daemon.exitCode !== null) {
      await close()
      throw new Error('the room never came up (pulseaudio)')
    }
    await sleep(100)
  }
  pactl('set-default-sink', defaultSink)
  pactl('set-default-source', MIC)
  const leak = roomLeaks(pactl('list', 'short', 'modules').stdout, pactl('list', 'short', 'sinks').stdout, sinks)
  if (leak !== null) {
    await close()
    throw new Error(`the room is not closed: ${leak}`)
  }
  return { server, children, close }
}

export async function openRoom(dir: string): Promise<Room> {
  const { server, children, close } = await startRoom(dir, [`module-null-sink sink_name=${SINK} rate=16000 channels=1`, `module-remap-source master=${SINK}.monitor source_name=${MIC} rate=16000 channels=1`], SINK, [SINK])
  // The app's player, held to the room: the pulse plugin, never ALSA's default.
  const aplay = join(dir, 'aplay')
  writeFileSync(aplay, `#!/bin/sh\nexec aplay -D pulse "$@"\n`)
  chmodSync(aplay, 0o755)
  return {
    server,
    aplay,
    play(wav) {
      children.push(spawn('paplay', ['-s', server, `--device=${SINK}`, wav], { stdio: 'ignore' }))
    },
    record(path) {
      children.push(spawn('parecord', ['-s', server, `--device=${SINK}.monitor`, '--rate=16000', '--channels=1', '--file-format=wav', path], { stdio: 'ignore' }))
    },
    close,
  }
}
