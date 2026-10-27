import type { IdleShown } from '../../core/idle/ipcChannels'

// When a downloaded Release installs (#419, ADR 0090): only while the Idle
// Screen is up, so an update never cuts off a command. The updater says when
// a download is done; the windows say what they show; this decides. The one
// road past the gate is the owner asking for it (#422): `installNow`.

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
  /** A Release finished downloading: its version. */
  downloaded(version: string): void
  /** A window's Idle Screen changed. */
  shownChanged(): void
  /** The version downloaded and waiting to install; null while none is. */
  ready(): string | null
  /** Installs the downloaded Release now, whatever the Idle Screen shows; nothing when none is, or it already has. */
  installNow(): void
}

export function createIdleInstall(deps: IdleInstallDeps): IdleInstall {
  let ready: string | null = null
  let installed = false
  const install = (): void => {
    if (ready === null || installed) return
    installed = true
    deps.install()
  }
  const tryInstall = (): void => {
    const windows = deps.windows()
    if (windows.length === 0 || !windows.every(restsForUpdate)) return
    install()
  }
  return {
    downloaded(version) {
      ready = version
      tryInstall()
    },
    shownChanged: tryInstall,
    ready: () => (installed ? null : ready),
    installNow: install,
  }
}
