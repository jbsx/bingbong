import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { reportFault } from '../../core/trace/fault'
import type { IdleShown } from '../../core/idle/ipcChannels'
import type { UpdateCheck } from '../../core/update/updateCheck'
import { createIdleInstall } from './idleInstall'
import { createCheckNow } from './checkNow'

// The kiosk follows the Releases (#419, ADR 0090): every hour the packaged
// app asks GitHub for a newer Release of the `production` branch, downloads
// it in the background, and installs and relaunches only at the Idle Screen.
// A spoken or typed update (#422) asks the same now, and installs a Release
// already downloaded at once.

const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * The exit code that means "installed, start me again". bingbong.service
 * restarts on it (RestartForceExitStatus), since Restart=on-failure leaves
 * a clean exit down; scripts/kiosk-install.sh writes the same number.
 */
export const RELAUNCH_EXIT_CODE = 75

/** The updater runs `<new AppImage>` with this set and waits for it to exit (electron-updater's AppImageUpdater). */
export function exitsAfterInstall(env: Record<string, string | undefined>): boolean {
  return env.APPIMAGE_EXIT_AFTER_INSTALL === 'true'
}

export interface Updater {
  /** A window's Idle Screen changed: what every open window last said. */
  shownChanged(): void
  /** An update asked for now (#422): a Release already downloaded installs once its Answer is said; otherwise GitHub is asked. */
  checkNow(): Promise<UpdateCheck>
}

/**
 * Starts the hourly check in the packaged AppImage; elsewhere (a checkout,
 * the e2e suite) there is nothing to update and it does nothing.
 */
export function attachUpdater(options: { windows(): readonly IdleShown[]; env: Record<string, string | undefined> }): Updater {
  if (!app.isPackaged || !options.env.APPIMAGE) return { shownChanged: () => {}, checkNow: async () => ({ kind: 'unavailable' }) }
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  // One road in: the Idle Screen, never a quit in the middle of something.
  autoUpdater.autoInstallOnAppQuit = false
  // Under systemd (INVOCATION_ID) the unit starts the new version; anywhere else the updater does.
  const underSystemd = (options.env.INVOCATION_ID ?? '') !== ''
  const gate = createIdleInstall({
    windows: options.windows,
    install: () => {
      if (underSystemd) app.once('will-quit', (event) => {
        event.preventDefault()
        app.exit(RELAUNCH_EXIT_CODE)
      })
      autoUpdater.quitAndInstall(true, !underSystemd)
    },
  })
  autoUpdater.on('update-downloaded', (info) => gate.downloaded(info.version))
  // Every failure, a check's or a download's, arrives here: one fault each.
  autoUpdater.on('error', (error) => reportFault('update.autoUpdater', error))
  const check = (): void => {
    // The 'error' event above has already reported it.
    autoUpdater.checkForUpdates().catch(() => {})
  }
  check()
  setInterval(check, CHECK_EVERY_MS).unref()
  const checkNow = createCheckNow({
    gate,
    runningVersion: app.getVersion(),
    // A failed check rejects here too, after the 'error' event above has reported it.
    check: async () => {
      const result = await autoUpdater.checkForUpdates()
      return result === null ? null : { available: result.isUpdateAvailable, version: result.updateInfo.version }
    },
  })
  return { shownChanged: () => gate.shownChanged(), checkNow }
}
