/** The News card (CONTEXT.md): the Idle Screen asks main for Today's Highlight and Big News while it shows. */
export const NEWS_IPC = {
  horizons: 'news:horizons',
} as const

/** The scheme main serves the cached Story Images on: the renderer loads a story's picture from it, never from the network. */
export const NEWS_IMAGE_SCHEME = 'bingbong-news'
