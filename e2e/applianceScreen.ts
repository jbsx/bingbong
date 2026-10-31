import { spawn, type ChildProcess } from 'node:child_process'

export const APPLIANCE_WIDTH = 1920
export const APPLIANCE_HEIGHT = 1080

/** The appliance's screen: an X server of its own, whatever size the suite's display is. */
export interface ApplianceScreen {
  display: string
  xvfb: ChildProcess
}

export async function startApplianceScreen(): Promise<ApplianceScreen> {
  // -displayfd: the server picks a free display and writes its number to stdout.
  const xvfb = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', `${APPLIANCE_WIDTH}x${APPLIANCE_HEIGHT}x24`, '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'] })
  const number = await new Promise<string>((resolve, reject) => {
    xvfb.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString().trim()))
    xvfb.once('error', reject)
    xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with ${String(code)}`)))
  })
  return { display: `:${number}`, xvfb }
}
