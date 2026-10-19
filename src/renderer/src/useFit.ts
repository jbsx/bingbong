import { useLayoutEffect, type RefObject } from 'react'

/** The smallest share of its own size text is stepped down to before the box gives up and drops what it can. */
const FIT_FLOOR = 0.55
const FIT_STEP = 0.05

function overflows(box: HTMLElement): boolean {
  return box.scrollHeight > box.clientHeight + 1
}

/**
 * Text that shows whole rather than clipped: the box's `--fit` is stepped
 * down from 1 until what it holds fits its height, and its sizes read it
 * (styles.css, `calc(… * var(--fit))`, each with a floor of its own). Past
 * FIT_FLOOR the box is marked with each of `stages` in turn as
 * `data-fit="<stage>"` — for the stylesheet to give up something, the least
 * first — until it fits or the last is reached. Refitted whenever the box
 * changes size and when `key` (what it shows) changes.
 */
export function useFitText(ref: RefObject<HTMLElement | null>, key: unknown, stages: readonly string[] = ['over']): void {
  const order = stages.join(' ')
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    const fit = (): void => {
      let scale = 1
      box.removeAttribute('data-fit')
      box.style.setProperty('--fit', '1')
      while (overflows(box) && scale > FIT_FLOOR) {
        scale = Math.round((scale - FIT_STEP) * 100) / 100
        box.style.setProperty('--fit', String(scale))
      }
      for (const stage of order.split(' ')) {
        if (!overflows(box)) break
        box.setAttribute('data-fit', stage)
      }
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [ref, key, order])
}

/** A list that shows whole items only: the first item the box's bottom edge would cut, and every one after it, is hidden rather than shown half. */
export function useWholeItems(ref: RefObject<HTMLElement | null>, key: unknown): void {
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    const fit = (): void => {
      const items = [...box.children] as HTMLElement[]
      for (const item of items) item.hidden = false
      const bottom = box.getBoundingClientRect().bottom
      const cut = items.findIndex((item) => item.getBoundingClientRect().bottom > bottom + 1)
      if (cut !== -1) for (const item of items.slice(cut)) item.hidden = true
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [ref, key])
}
