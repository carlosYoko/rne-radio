import type { PlayerState } from "../domain/player.js";
import { isFreshSong, type CurrentSong } from "../domain/song.js";
import type { SongRefresher, SongRequestView } from "./ports.js";

/** Consulta explícita sin tocar el audio ni crear otro propietario de metadatos. */
export class SongRequestController {
  private state: PlayerState | undefined;
  private busy = false;
  private message = "";
  private revision = 0;
  private disposed = false;

  constructor(
    private readonly refresher: SongRefresher,
    private readonly view: SongRequestView,
    private readonly now: () => number = Date.now
  ) {}

  update(state: PlayerState): void {
    if (this.disposed) return;
    if (this.state?.stationId !== state.stationId || this.eligible(this.state) !== this.eligible(state)) {
      this.revision++;
      this.busy = false;
      this.message = state.stationId === "rner3" && !this.eligible(state)
        ? "Reproduce Radio 3 para consultar su canción." : "";
    }
    this.state = state;
    this.render();
  }
  async request(): Promise<void> {
    if (this.disposed || this.busy || !this.eligible(this.state)) return;
    const revision = this.revision;
    this.busy = true;
    this.message = "Consultando RTVE…";
    this.render();
    try {
      const song = await this.refresher.refresh();
      if (!this.isCurrent(revision)) return;
      this.message = song && isFreshSong(song, this.now())
        ? ""
        : "RTVE no ofrece una identificación reciente.";
    } catch {
      if (!this.isCurrent(revision)) return;
      this.message = "No se ha podido consultar RTVE. Inténtalo de nuevo.";
    } finally {
      if (this.isCurrent(revision)) {
        this.busy = false;
        this.render();
      }
    }
  }
  receive(song: CurrentSong | null): void {
    if (this.disposed || this.busy || !this.eligible(this.state) || !this.message) return;
    if (song && isFreshSong(song, this.now())) {
      this.message = "";
      this.render();
    }
  }
  dispose(): void { this.disposed = true; this.revision++; }
  private eligible(state: PlayerState | undefined): boolean {
    return state?.stationId === "rner3" && (state.status === "playing" || state.status === "buffering");
  }
  private isCurrent(revision: number): boolean { return !this.disposed && this.revision === revision; }
  private render(): void {
    this.view.renderSongRequest({
      visible: this.state?.stationId === "rner3", enabled: this.eligible(this.state) && !this.busy,
      busy: this.busy, message: this.message
    });
  }
}
