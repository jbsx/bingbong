/** The few hast node shapes this walk reads; react-markdown hands it the whole tree. */
type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] }

/**
 * A rehype step for an Answer's Card: a line break may fall after any
 * slash in its text, so a long address or file path wraps inside the Card
 * at its slashes rather than mid-word — the rule the Command bubble's
 * BreaksAtSlashes follows (#333). Text inside code keeps its exact
 * characters; a link's href is an attribute and is never touched.
 */
export function rehypeBreakAfterSlashes() {
  return (tree: HastNode): void => {
    breakAfterSlashes(tree)
  }
}

function breakAfterSlashes(node: HastNode): void {
  if (node.children === undefined || node.tagName === 'code' || node.tagName === 'pre') return
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || child.value === undefined || !child.value.includes('/')) {
      breakAfterSlashes(child)
      return [child]
    }
    const parts = child.value.split(/(?<=\/)/)
    return parts.flatMap((part, index): HastNode[] =>
      index < parts.length - 1
        ? [{ type: 'text', value: part }, { type: 'element', tagName: 'wbr', properties: {}, children: [] }]
        : [{ type: 'text', value: part }],
    )
  })
}
