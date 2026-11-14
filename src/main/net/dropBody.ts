/**
 * A fetch answered but read no further: its body is cancelled, which closes the socket.
 *
 * Left unread, a body over undici's high-water mark pauses its parser, and the
 * server closing the connection then throws `assert(!this.paused)` from the
 * socket's 'end' handler, where no caller can catch it (nodejs/undici#5360;
 * Node 24.17+ as Electron 43 ships, and Node 22). In the main process that is
 * Electron's error dialog on the kiosk. Every road that returns or throws on a
 * status without reading the body calls this first.
 */
export async function dropBody(response: { readonly body?: ReadableStream<Uint8Array> | null }): Promise<void> {
  await response.body?.cancel().catch(() => {})
}
