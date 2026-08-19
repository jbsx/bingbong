// Moonshine Base's tokenizer half for the #39 A/B harness (dev tool only —
// nothing in the shipped voice path imports this). Moonshine ships a
// SentencePiece-BPE vocab (Llama-style): specials '<unk>'/'<s>'/'</s>', 256
// '<0xNN>' byte-fallback pieces, then merge pieces where '▁' (U+2581) marks a
// leading space. Decoding follows the model card's own tokenizer.json decoder
// spec — Replace('▁' → ' '), ByteFallback, Fuse, Strip(one leading space) —
// so harness transcripts match what the reference runtimes print.

export interface MoonshineVocab {
  /** id → piece; holes decode to nothing (defensive against odd vocabs). */
  pieces: string[]
  /** Token ids never rendered (specials like <s>/</s>). */
  specialIds: ReadonlySet<number>
}

const BYTE_PIECE = /^<0x([0-9A-Fa-f]{2})>$/

/** Parses a HuggingFace tokenizer.json (string contents) into a vocab. */
export function parseMoonshineTokenizer(json: string): MoonshineVocab {
  const parsed: unknown = JSON.parse(json)
  const vocab = (parsed as { model?: { vocab?: unknown } })?.model?.vocab
  if (vocab === undefined || vocab === null || typeof vocab !== 'object' || Array.isArray(vocab)) {
    throw new Error('tokenizer.json has no model.vocab object')
  }

  let size = 0
  for (const id of Object.values(vocab as Record<string, unknown>)) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
      throw new Error('tokenizer.json vocab maps a piece to a non-integer id')
    }
    if (id >= size) size = id + 1
  }
  const pieces: string[] = new Array(size).fill('')
  for (const [piece, id] of Object.entries(vocab as Record<string, number>)) pieces[id] = piece

  const specialIds = new Set<number>()
  const added = (parsed as { added_tokens?: unknown })?.added_tokens
  if (Array.isArray(added)) {
    for (const token of added) {
      const { id, special } = token as { id?: unknown; special?: unknown }
      if (typeof id === 'number' && Number.isInteger(id) && special === true) specialIds.add(id)
    }
  }

  return { pieces, specialIds }
}

/**
 * Token ids → text: pieces join with '▁' read as a space, consecutive
 * '<0xNN>' pieces fuse as one UTF-8 run, specials and unknown ids drop out.
 * One leading space is stripped, mirroring the tokenizer's Strip decoder.
 */
export function decodeMoonshineTokens(vocab: MoonshineVocab, tokens: readonly number[]): string {
  let text = ''
  let bytes: number[] = []

  const flushBytes = (): void => {
    if (bytes.length === 0) return
    text += new TextDecoder('utf-8').decode(new Uint8Array(bytes))
    bytes = []
  }

  for (const token of tokens) {
    if (vocab.specialIds.has(token)) {
      flushBytes()
      continue
    }
    const piece = vocab.pieces[token]
    if (piece === undefined || piece === '') continue
    const byte = BYTE_PIECE.exec(piece)
    if (byte) {
      bytes.push(parseInt(byte[1], 16))
      continue
    }
    flushBytes()
    text += piece.replaceAll('▁', ' ')
  }
  flushBytes()
  return text.startsWith(' ') ? text.slice(1) : text
}
