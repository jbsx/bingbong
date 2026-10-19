import { BrowserWindow, ipcMain } from 'electron'
import { MUSIC_IPC } from '../../core/music/ipcChannels'
import type { Player } from './player'

// Now Playing's IPC (#344, CONTEXT.md Idle Screen): the Idle Screen pulls
// its window's Player on mount and hears every change, as the Timer's does.

const players = new WeakMap<BrowserWindow, Pick<Player, 'nowPlaying'>>()

export function registerNowPlayingIpc(): void {
  ipcMain.handle(MUSIC_IPC.get, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return (win ? players.get(win)?.nowPlaying() : null) ?? null
  })
}

/** The window's Player, published to its renderer; the returned function stops it. */
export function attachNowPlayingToWindow(win: BrowserWindow, player: Pick<Player, 'nowPlaying' | 'onChange'>): () => void {
  players.set(win, player)
  return player.onChange((nowPlaying) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(MUSIC_IPC.changed, nowPlaying)
  })
}
