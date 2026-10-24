import { BrowserWindow, dialog, ipcMain } from 'electron'
import { SETTINGS_IPC } from '../../core/settings/ipcChannels'

// The Settings page's folder picker (#424): the upload folder chosen with the
// mouse in the app's own dialog over its window — never the pane's chooser,
// which is intercepted. Answers the folder picked, or '' for none.

export function registerFolderPickerIpc(): void {
  ipcMain.handle(SETTINGS_IPC.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Upload folder', properties: ['openDirectory'] }
    const picked = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options)
    return picked.canceled ? '' : (picked.filePaths[0] ?? '')
  })
}
