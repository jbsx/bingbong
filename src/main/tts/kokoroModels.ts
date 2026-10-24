import { join } from 'node:path'
import { ensureModelFiles, modelFilesComplete, type MoonshineModelStore } from '../moonshine/moonshineModels'

// Where Kokoro-82M lives (#412): <userData>/models/<KOKORO_DIR>, fetched once
// on demand from onnx-community's export: the fp32 graph the owner heard
// (~326 MB; the q8 and fp16 variants are untested by ear) and its
// tokenizer.json. Each voice's style file (voices/<voice>.bin, Float32
// [510, 1, 256]) is fetched the first time that voice speaks.

export const KOKORO_DIR = 'kokoro-82m-v1.0'

const URL_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main'

/** The graph and its vocab, each with the size a finished download is at least. */
export const KOKORO_FILES = [
  { name: 'model.onnx', url: `${URL_BASE}/onnx/model.onnx`, minBytes: 325_000_000 },
  { name: 'tokenizer.json', url: `${URL_BASE}/tokenizer.json`, minBytes: 3_000 },
] as const

/** A voice's style file: 510 × 256 float32. */
export function kokoroVoiceFile(name: string): { name: string; url: string; minBytes: number } {
  return { name: join('voices', `${name}.bin`), url: `${URL_BASE}/voices/${name}.bin`, minBytes: 510 * 256 * 4 }
}

export function kokoroDir(modelsDir: string): string {
  return join(modelsDir, KOKORO_DIR)
}

/** Whether the graph and vocab are on disk, whole. */
export function kokoroModelReady(modelsDir: string, store: MoonshineModelStore): boolean {
  return modelFilesComplete(kokoroDir(modelsDir), KOKORO_FILES, store)
}

export function kokoroVoiceReady(modelsDir: string, name: string, store: MoonshineModelStore): boolean {
  return modelFilesComplete(kokoroDir(modelsDir), [kokoroVoiceFile(name)], store)
}

/** Fetches the graph and vocab where missing or cut short. */
export async function ensureKokoroModel(modelsDir: string, store: MoonshineModelStore): Promise<void> {
  await ensureModelFiles(kokoroDir(modelsDir), KOKORO_FILES, store)
}

/** Fetches one voice's style file where missing or cut short. */
export async function ensureKokoroVoice(modelsDir: string, name: string, store: MoonshineModelStore): Promise<void> {
  await ensureModelFiles(kokoroDir(modelsDir), [kokoroVoiceFile(name)], store)
}
