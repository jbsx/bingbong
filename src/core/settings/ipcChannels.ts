export const SETTINGS_IPC = {
  get: 'settings:get',
  update: 'settings:update',
  changed: 'settings:changed',
  /** Which agent roles resolve right now (#76). */
  routingStatus: 'settings:routingStatus',
  routingStatusChanged: 'settings:routingStatusChanged',
  /** The `.env` on the Settings page: its keys, one set or removal, and the file opened in the system's editor. */
  envList: 'settings:envList',
  envSet: 'settings:envSet',
  envOpen: 'settings:envOpen',
  /** What the host checks found missing at boot (#419): aplay, a microphone, a display. */
  hostChecks: 'settings:hostChecks',
  /** The monitors ddcutil finds for Night Dim (#413), and why none when it finds none. */
  monitors: 'settings:monitors',
} as const
