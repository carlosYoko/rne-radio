import type { AudioEngine, AudioEvent, Clock } from "../../application/ports.js";

export class HtmlAudioEngine implements AudioEngine {
  constructor(private readonly audio: HTMLAudioElement = new Audio()) { audio.preload = "none"; }
  play(url: string): Promise<void> {
    this.audio.src = url;
    this.audio.load();
    return this.audio.play();
  }
  release(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
  setVolume(volume: number): void { this.audio.volume = volume; }
  on(event: AudioEvent, listener: () => void): () => void {
    const handler = () => {
      if (event !== "error" || this.audio.error) listener();
    };
    this.audio.addEventListener(event, handler);
    return () => this.audio.removeEventListener(event, handler);
  }
}

export const browserClock: Clock = {
  after(milliseconds, callback) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  }
};
