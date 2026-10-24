import type { IdleShown } from '../../core/idle/ipcChannels'

// When a downloaded Release installs (#419, ADR 0090): only while the Idle
// Screen is up, so an update never cuts off a command. The updater says when
// a download is done; the windows say what they show; this decides.

/** The Idle Screen is up and its Prompt shut: nothing is being asked or typed. */
export function restsForUpdate(shown: IdleShown): boolean {
  return shown.up && !shown.open && !shown.prompting
}

export interface IdleInstallDeps {
  /** What each open window last said of its Idle Screen. */
  windows(): readonly IdleShown[]
  /** Quit, install and relaunch. */
  install(): void
}

export interface IdleInstall {
  /** A Release finished downloading. */
  downloaded(): void
  /** A window's Idle Screen changed. */
  shownChanged(): void
}

export function createIdleInstall(deps: IdleInstallDeps): IdleInstall {
  let ready = false
  let installed = false
  const tryInstall = (): void => {
    if (!ready || installed) return
    const windows = deps.windows()
    if (windows.length === 0 || !windows.every(restsForUpdate)) return
    installed = true
    deps.install()
  }
  return {
    downloaded() {
      ready = true
      tryInstall()
    },
    shownChanged: tryInstall,
  }
}
