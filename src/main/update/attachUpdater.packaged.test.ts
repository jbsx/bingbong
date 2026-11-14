import { describe, expect, it, vi } from 'vitest'

// The installed AppImage, as a `kiosk:push` build runs it: a prerelease version.
const autoUpdater = vi.hoisted(() => ({
  allowPrerelease: true,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.1.4-local.202610311929', once: vi.fn() } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater } }))

const { attachUpdater } = await import('./attachUpdater')

describe('attachUpdater in the installed AppImage', () => {
  it('follows Releases only, even when the running version is a kiosk:push prerelease', () => {
    attachUpdater({ windows: () => [], env: { APPIMAGE: '/home/kiosk/.local/bin/bingbong.AppImage' } })
    expect(autoUpdater.allowPrerelease).toBe(false)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })
})
