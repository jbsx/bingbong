import { mkdirSync, writeFileSync } from 'node:fs'
import type { UtteranceDumpWriter } from '../../core/voice/utteranceDump'

// The fs half of #34's utterance dumper: a thin adapter over Node fs, the
// same split as the perf tracer (core factory with an injectable writer,
// main supplies the filesystem). Failures land here only as throws — the
// dumper swallows them, so a dead dumps dir never touches the voice path.

export const fsUtteranceDumpWriter: UtteranceDumpWriter = {
  mkdir(dir) {
    mkdirSync(dir, { recursive: true })
  },
  writeFile(path, bytes) {
    writeFileSync(path, bytes)
  },
}
