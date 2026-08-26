import { homedir } from 'node:os'
import { join } from 'node:path'
import { applySeed } from '../src/main/kiosk/seed.ts'

// Kiosk deployment (ADR 0023) first-run step: mirror the image's baked model
// assets into the bind-mounted userData dir, copy-if-missing, then let the
// entrypoint exec Electron. No-ops (and exits 0) when no baked root exists,
// so the same command is harmless outside the container.

const bakedRoot = process.env.BINGBONG_BAKED_ASSETS_ROOT?.trim() || '/opt/bingbong/assets'
const userDataDir =
  process.env.BINGBONG_USER_DATA_DIR?.trim() || join(homedir(), '.config', 'bingbong')

const result = applySeed(bakedRoot, userDataDir)
console.log(`[kiosk-seed] ${result.copied} seeded, ${result.skipped} kept (baked: ${bakedRoot} → ${userDataDir})`)
