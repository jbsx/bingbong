// The QN-Scale's protocol (CONTEXT.md, Scale Listener): RENPHO's OEM scale,
// the Yolanda/QN protocol type 1 that openScale's QNHandler.kt reads — its
// behaviour ported here, not its code. The scale notifies frames on ffe1
// (and ffe2); Bing Bong writes its replies to ffe3 (config) and ffe4 (time).
// Every reply echoes the protocol type the scale's own frames carry in
// byte 2, and ends in a checksum: the byte sum & 0xff.
//
//   0x12 scale info  → 0x13 config (unit kg) on ffe3, then 02 <time> on ffe4
//   0x14 ack         → 0x20 <time> on ffe3
//   0x10 reading     — bytes[3..4] big-endian weight (÷100 or ÷10, as the
//                      info said), byte 5 = 1 when stable, bytes[6..7] and
//                      [8..9] two resistances, big-endian.

/** The characteristics the scale is written through: ffe3 for config, ffe4 for the time. */
export type QnCharacteristic = 'ffe3' | 'ffe4'

/** Seconds from the Unix epoch to the QN epoch the scale counts from. */
export const QN_EPOCH_OFFSET_S = 946_702_800

/** A frame the scale sent, read. */
export type QnFrame =
  | { kind: 'info'; protocolType: number; divisor: 10 | 100 }
  | { kind: 'ack'; protocolType: number }
  | { kind: 'reading'; protocolType: number; kg: number; stable: boolean; r1: number; r2: number }
  | { kind: 'other'; protocolType: number | null }

export interface QnWrite {
  characteristic: QnCharacteristic
  bytes: Uint8Array
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

/** A reply with its checksum filled into the last byte. */
function withChecksum(bytes: number[]): Uint8Array {
  const sum = bytes.slice(0, -1).reduce((total, byte) => total + byte, 0) & 0xff
  return Uint8Array.from([...bytes.slice(0, -1), sum])
}

/** Seconds since the QN epoch, little-endian, as the time replies carry them. */
function qnTime(at: number): number[] {
  const seconds = Math.floor(at / 1000) - QN_EPOCH_OFFSET_S
  return [seconds & 0xff, (seconds >>> 8) & 0xff, (seconds >>> 16) & 0xff, (seconds >>> 24) & 0xff]
}

/** Read one frame; `divisor` is the one the scale's info frame named (÷100 until it says otherwise). */
export function decodeFrame(bytes: Uint8Array, divisor: 10 | 100 = 100): QnFrame {
  if (bytes.length < 3) return { kind: 'other', protocolType: null }
  const protocolType = bytes[2]
  switch (bytes[0]) {
    case 0x10:
      if (bytes.length < 10) return { kind: 'other', protocolType }
      return { kind: 'reading', protocolType, kg: u16be(bytes, 3) / divisor, stable: bytes[5] === 1, r1: u16be(bytes, 6), r2: u16be(bytes, 8) }
    case 0x12:
      if (bytes.length < 11) return { kind: 'other', protocolType }
      return { kind: 'info', protocolType, divisor: bytes[10] === 1 ? 100 : 10 }
    case 0x14:
      return { kind: 'ack', protocolType }
    default:
      return { kind: 'other', protocolType }
  }
}

/** What Bing Bong writes back to a frame at time `at` (ms): the kg config and the time to the info, the time to the ack, nothing to the rest. */
export function replyTo(frame: QnFrame, at: number): QnWrite[] {
  switch (frame.kind) {
    case 'info':
      return [
        // 0x01 is kg (ruled, #350); the height, age and sex bytes stay 0 for every protocol type but the 0xFF family.
        { characteristic: 'ffe3', bytes: withChecksum([0x13, 0x09, frame.protocolType, 0x01, 0x10, 0x00, 0x00, 0x00, 0x00]) },
        { characteristic: 'ffe4', bytes: Uint8Array.from([0x02, ...qnTime(at)]) },
      ]
    case 'ack':
      return [{ characteristic: 'ffe3', bytes: withChecksum([0x20, 0x08, frame.protocolType, ...qnTime(at), 0x00]) }]
    default:
      return []
  }
}
