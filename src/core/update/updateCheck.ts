// A spoken or typed update (#422): what asking for a newer Release now
// found, by kind, and the fixed Answer each says. No model writes it.

/** What an update asked for now found. */
export type UpdateCheck =
  /** A Release was already downloaded: said first, then `install` quits, installs and relaunches. */
  | { readonly kind: 'installing'; readonly version: string; install(): void }
  /** A newer Release was found: its download started or is under way, and it installs at the Idle Screen. */
  | { readonly kind: 'downloading'; readonly version: string }
  /** No newer Release: the running version. */
  | { readonly kind: 'current'; readonly version: string }
  /** Not the installed AppImage (a checkout, the e2e suite): there is nothing to update. */
  | { readonly kind: 'unavailable' }
  /** The check failed; the updater's own fault has reported it. */
  | { readonly kind: 'failed' }

/** The Answer an update says, naming the version. */
export function updateAnswer(check: UpdateCheck): string {
  switch (check.kind) {
    case 'installing':
      return `Installing version ${check.version}, back in a moment.`
    case 'downloading':
      return `Downloading version ${check.version}; it installs when the screen is idle.`
    case 'current':
      return `Up to date, version ${check.version}.`
    case 'unavailable':
      return 'Updates only run in the installed app.'
    case 'failed':
      return "Couldn't check for updates."
  }
}
