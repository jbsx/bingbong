import { ipcMain } from 'electron'
import { gatherEvents, type CalendarRange, type CalendarSource } from '../../core/calendar/calendar'
import { CALENDAR_IPC } from '../../core/calendar/ipcChannels'

/**
 * The Calendar's IPC (CONTEXT.md): the Idle Screen asks for the range its
 * month covers and gets every source's events in it. Sources live in main,
 * where a provider's credentials and network calls belong.
 */
export function registerCalendarIpc(sources: readonly CalendarSource[]): void {
  ipcMain.handle(CALENDAR_IPC.events, (_event, range: CalendarRange) => gatherEvents(sources, range))
}
