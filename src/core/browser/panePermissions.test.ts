import { describe, expect, it } from 'vitest'
import { panePermits, permissionDeniedLine } from './panePermissions'

// The pane's permission policy (#423): the microphone and camera stay the
// wake word's and STT's, notifications never pop, a few page needs pass,
// and anything else is denied. A guess (no measure reaches it), one table.

describe('panePermits', () => {
  it.each(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])('allows %s', (permission) => {
    expect(panePermits(permission)).toBe(true)
  })

  it.each(['media', 'notifications', 'geolocation', 'clipboard-read', 'midi', 'unknown'])('denies %s', (permission) => {
    expect(panePermits(permission)).toBe(false)
  })
})

describe('permissionDeniedLine', () => {
  it('names the denied permission and the page that asked', () => {
    expect(permissionDeniedLine('media', 'https://meet.example/room')).toBe('permission denied: media (https://meet.example/room)')
  })
})
