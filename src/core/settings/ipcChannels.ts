export const SETTINGS_IPC = {
  get: 'settings:get',
  update: 'settings:update',
  changed: 'settings:changed',
  /** Which agent roles resolve right now (#76). */
  routingStatus: 'settings:routingStatus',
  routingStatusChanged: 'settings:routingStatusChanged',
} as const
