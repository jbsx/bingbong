import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppDirs } from './appDirs'

describe('resolveAppDirs', () => {
  it('reads the shipped models beside the archive and the sidecar from its unpacked copy in the AppImage (ADR 0090)', () => {
    expect(resolveAppDirs({ isPackaged: true, appPath: '/tmp/.mount_x/resources/app.asar', resourcesPath: '/tmp/.mount_x/resources' })).toEqual({
      bundledModelsDir: join('/tmp/.mount_x/resources', 'models'),
      scriptsDir: join('/tmp/.mount_x/resources', 'app.asar.unpacked', 'scripts'),
    })
  })

  it('reads them from the repo in a checkout', () => {
    expect(resolveAppDirs({ isPackaged: false, appPath: '/src/bingbong', resourcesPath: '/src/bingbong/node_modules/electron/dist/resources' })).toEqual({
      bundledModelsDir: join('/src/bingbong', 'models'),
      scriptsDir: join('/src/bingbong', 'scripts'),
    })
  })
})
