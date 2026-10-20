import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { isolateScriptlet } from './scriptlets'

// Shaped like the library's assembly: shared globals, a lexical dependency,
// then the scriptlet called with its arguments.
const assembled = (arg: string): string =>
  `if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; };class JSONPath{};(function edit(n){new JSONPath();ran.push(n)})('${arg}')`

describe('isolateScriptlet', () => {
  it('runs two scriptlets sharing a lexical dependency in one page', () => {
    const ran: string[] = []
    const page = { ran }
    runInNewContext(isolateScriptlet(assembled('one')), page)
    runInNewContext(isolateScriptlet(assembled('two')), page)
    expect(ran).toEqual(['one', 'two'])
  })

  it('is what keeps the second one alive: bare, it dies on the redeclaration', () => {
    const page = { ran: [] as string[] }
    runInNewContext(assembled('one'), page)
    expect(() => runInNewContext(assembled('two'), page)).toThrow(/already been declared/)
  })
})
