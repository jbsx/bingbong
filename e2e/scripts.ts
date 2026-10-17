export function urlBarNavigationScript(url: string): string {
  return `(async () => {
    const input = document.querySelector('.url-input')
    if (!input) return 'no-url-input'
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(url)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector('.url-form').requestSubmit()
    return 'submitted'
  })()`
}

// Drives the Prompt Bar in the feed panel's footer — the one typed-input
// surface.
export function promptBarScript(text: string): string {
  return `(async () => {
    const input = document.querySelector('.prompt-input')
    if (!input) return 'no-prompt-input'
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector('.prompt-form').requestSubmit()
    return 'submitted'
  })()`
}
