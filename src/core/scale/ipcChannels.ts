/** The Weight card, the Weight page and the Weigh-in pop-up (CONTEXT.md): the Weigh-ins and the scale's live state, from main. */
export const WEIGHT_IPC = {
  /** invoke → WeighIn[], oldest first. */
  list: 'weight:list',
  /** invoke(at) → WeighIn[] without the one at that time (a mis-weigh, a guest). */
  remove: 'weight:remove',
  /** main → renderers: WeighIn[] after any change. */
  changed: 'weight:changed',
  /** invoke → WeighInPopupState. */
  popup: 'weight:popup',
  /** main → renderers: WeighInPopupState. */
  popupChanged: 'weight:popup-changed',
  /** invoke → ScaleStatus. */
  status: 'weight:status',
  /** main → renderers: ScaleStatus. */
  statusChanged: 'weight:status-changed',
} as const

/**
 * The Scale Listener's state, as the settings Body section shows it:
 * looking for the scale, talking to it, unable to (Bluetooth missing, off
 * or without LE — `detail` says which), or replaced by the e2e stand-in.
 */
export type ScaleStatus = { state: 'searching' | 'connected' | 'unavailable' | 'stand-in'; detail: string }
