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
