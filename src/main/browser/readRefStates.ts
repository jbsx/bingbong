// The Ref State of each ref, read from Chrome's accessibility tree after a
// collect: the registry the collector left in the page (ADR 0033) is held
// as a remote object, each element that becomes a ref is asked of the tree
// on its own — a ref's node, never the whole page's tree — and the handles
// are let go. A ref whose node is gone costs only its own state, and the
// misses are one fault; a registry that cannot be held is the caller's to
// report. A page without its states is still a page.

import { refStatesOf, type AxNode } from '../../core/browser/refStates'
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

/** The page with each ref's Ref State on its element; elements the tree said nothing of are left as they were. */
export async function readRefStates(cdp: CdpDebugger, page: CollectedPage): Promise<CollectedPage> {
  const indices = refElementIndices(page)
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
    const states = new Map<number, string[]>()
    // Each ref is its own read: a node gone since the collect costs its own state, not the page's.
    const misses = (
      await Promise.all(
        indices.map(async (index): Promise<string | null> => {
          const handle = handles.get(String(index))
          const element = page.elements[index]
          if (handle === undefined || element === undefined) return null
          try {
            const tree = await cdp.send<PartialTreeResponse>('Accessibility.getPartialAXTree', { objectId: handle, fetchRelatives: false })
            const node = tree.nodes?.[0]
            const said = node === undefined ? [] : refStatesOf(node, { kind: refKindOf(element), label: element.label, inputType: element.inputType })
            if (said.length > 0) states.set(index, said)
            return null
          } catch (error) {
            return error instanceof Error ? error.message : String(error)
          }
        }),
      )
    ).filter((miss): miss is string => miss !== null)
    if (misses.length > 0) reportFault('browser.readRefStates.refs', new Error(`${misses.length} of ${indices.length} refs unread: ${misses[0]}`))
    return { ...page, elements: page.elements.map((element, index) => (states.has(index) ? { ...element, states: states.get(index) } : element)) }
  } finally {
    // A page gone by now took its handles with it: the states read still stand.
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: HANDLES }).catch((error: unknown) => reportFault('browser.readRefStates.release', error))
  }
}
