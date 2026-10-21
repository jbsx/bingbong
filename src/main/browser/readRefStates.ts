// The Ref State of each ref, read from Chrome's accessibility tree after a
// collect, and the label the browser computes for a ref the page gave no
// words (#382, ADR 0084): the registry the collector left in the page (ADR 0033) is held
// as a remote object, each element that becomes a ref is asked of the tree
// on its own — a ref's node, never the whole page's tree — and the handles
// are let go. A ref whose node is gone costs only its own state, and the
// misses are one fault; a registry that cannot be held is the caller's to
// report. A page without its states is still a page.

import { refStatesOf, type AxNode, type RefRead } from '../../core/browser/refStates'
import { refElementIndices, refKindOf, type CollectedPage } from '../../core/browser/snapshot'
import { reportFault } from '../../core/trace/fault'
import type { CdpDebugger } from './createCdpBrowserController'

/** The object group the registry's handles are taken in, so one call releases them all. */
const HANDLES = 'bingbong-ref-states'

interface RemoteObjectResponse {
  readonly result?: { readonly objectId?: string }
}

interface PropertiesResponse {
  readonly result?: readonly { readonly name: string; readonly value?: { readonly objectId?: string } }[]
}

interface PartialTreeResponse {
  readonly nodes?: readonly AxNode[]
}

/**
 * The page with each ref's Ref State on its element; elements the tree said
 * nothing of are left as they were. `registryIndexOf` says where an element
 * sits in the top document's registry, null for one read in a frame (#377),
 * which this session's tree cannot reach; absent, the element's own index.
 */
export async function readRefStates(cdp: CdpDebugger, page: CollectedPage, registryIndexOf: (index: number) => number | null = (index) => index): Promise<CollectedPage> {
  const indices = refElementIndices(page).filter((index) => registryIndexOf(index) !== null)
  if (indices.length === 0) return page
  try {
    const registry = await cdp.send<RemoteObjectResponse>('Runtime.evaluate', {
      expression: '/* REF_HANDLES */ window.__bingbongRefs',
      objectGroup: HANDLES,
    })
    const objectId = registry.result?.objectId
    if (objectId === undefined) throw new Error('the page holds no ref registry')
    const properties = await cdp.send<PropertiesResponse>('Runtime.getProperties', { objectId, ownProperties: true })
    const handles = new Map((properties.result ?? []).map((property) => [property.name, property.value?.objectId]))
    const reads = new Map<number, RefRead>()
    // Each ref is its own read: a node gone since the collect costs its own state, not the page's.
    const misses = (
      await Promise.all(
        indices.map(async (index): Promise<string | null> => {
          const handle = handles.get(String(registryIndexOf(index)))
          const element = page.elements[index]
          if (handle === undefined || element === undefined) return null
          try {
            const tree = await cdp.send<PartialTreeResponse>('Accessibility.getPartialAXTree', { objectId: handle, fetchRelatives: false })
            const node = tree.nodes?.[0]
            const read = node === undefined ? null : refStatesOf(node, { kind: refKindOf(element), label: element.label, inputType: element.inputType })
            if (read !== null && (read.label !== undefined || read.states.length > 0)) reads.set(index, read)
            return null
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }),
      )
    ).filter((miss): miss is string => miss !== null)
    if (misses.length > 0) reportFault('browser.readRefStates.refs', new Error(`${misses.length} of ${indices.length} refs unread: ${misses[0]}`))
    return {
      ...page,
      elements: page.elements.map((element, index) => {
        const read = reads.get(index)
        if (read === undefined) return element
        // A ref the page gave no words takes the browser's accessible name (#382, ADR 0084).
        return { ...element, ...(read.label !== undefined ? { label: read.label, named: true as const } : {}), ...(read.states.length > 0 ? { states: read.states } : {}) }
      }),
    }
  } finally {
    // A page gone by now took its handles with it: the states read still stand.
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: HANDLES }).catch((error: unknown) => reportFault('browser.readRefStates.release', error))
  }
}
