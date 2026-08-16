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

export function commandBoxScript(text: string): string {
  return `(async () => {
    const input = document.querySelector('.command-input')
    if (!input) return 'no-command-input'
    if (input.disabled) return 'command-input-disabled'
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector('.command-form').requestSubmit()
    return 'submitted'
  })()`
}

// Clicks the first action button (Approve) of the confirmation dialog, if shown.
export function approveConfirmationScript(): string {
  return `(() => {
    const card = document.querySelector('.confirmation-card')
    if (!card) return 'no-confirmation'
    const approve = card.querySelector('.confirmation-actions button')
    if (!approve) return 'no-approve-button'
    approve.click()
    return 'approved'
  })()`
}
