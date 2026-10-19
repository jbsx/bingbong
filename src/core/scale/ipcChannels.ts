/** The Weight card, the Weight page and the Weigh-in pop-up (CONTEXT.md): the Weigh-ins and the scale's live state, from main. */
export const WEIGHT_IPC = {
  /** invoke → WeighIn[], oldest first. */
  list: 'weight:list',
  /** invoke(at) → WeighIn[] without the one at that time (a mis-weigh, a guest). */
  remove: 'weight:remove',
  /** invoke(at, personId) → WeighIn[] with that one given to the Person (a wrong guess fixed). */
  move: 'weight:move',
  /** invoke(personId) → WeighIn[] without that Person's, who is gone from settings too; Jaish is never removed. */
  removePerson: 'weight:remove-person',
  /** main → renderers: WeighIn[] after any change. */
  changed: 'weight:changed',
  /** invoke → WeighInPopupState. */
  popup: 'weight:popup',
  /** main → renderers: WeighInPopupState. */
  popupChanged: 'weight:popup-changed',
  /** dashboard → main: the rect of the pop-up's own view over the browsing pane, 0×0 when it is not there. */
  popupRect: 'weight:popup-rect',
  /** invoke → ScaleStatus. */
  status: 'weight:status',
  /** main → renderers: ScaleStatus. */
  statusChanged: 'weight:status-changed',
} as const

/**
 * The Scale Listener's state, as the settings Weight section shows it:
 * looking for the scale, talking to it, unable to (Bluetooth missing, off
 * or without LE — `detail` says which), or replaced by the e2e stand-in.
 */
export type ScaleStatus = { state: 'searching' | 'connected' | 'unavailable' | 'stand-in'; detail: string }
