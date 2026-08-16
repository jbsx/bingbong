import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('bingbong', {
  version: '0.1.0',
})
