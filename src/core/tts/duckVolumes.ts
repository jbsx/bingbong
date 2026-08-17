// Ducking lowers the pane's media elements while the assistant talks. The
// volume math runs here in core (unit-tested); the main adapter ships these
// tiny scripts into the page via executeJavaScript.

/** Page audio drops to this fraction of its prior level during speech. */
export const DUCK_FACTOR = 0.15

export function duckedVolumes(volumes: number[], factor: number): number[] {
  return volumes.map((volume) => Math.min(1, Math.max(0, volume * factor)))
}

export const COLLECT_MEDIA_VOLUMES_SCRIPT =
  'Array.from(document.querySelectorAll("audio,video")).map((media) => media.volume)'

export function applyMediaVolumesScript(volumes: number[]): string {
  return `(() => { const volumes = ${JSON.stringify(volumes)}; document.querySelectorAll("audio,video").forEach((media, index) => { if (index < volumes.length) media.volume = volumes[index]; }); })()`
}
