export interface TtsSpeaker {
  speak(text: string): Promise<void>
}
