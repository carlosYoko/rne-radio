import type { PlayerState } from "../domain/player.js";
import { isFreshSong, type CurrentSong } from "../domain/song.js";
import type { Clock, SongProvider, SongView } from "./ports.js";

/** Solo muestra identificaciones recientes mientras se reproduce Radio 3. */
export class SongController {
  private active = false;
  private disposed = false;
  private revision = 0;
  private received = 0;
  private pending: { revision: number; promise: Promise<void> } | undefined;
  private visible: CurrentSong | null = null;
  private latest: CurrentSong | null = null;
  private cancelRefresh: (() => void) | undefined;
  private cancelExpiry: (() => void) | undefined;

  constructor(
    private readonly provider: SongProvider,
    private readonly view: SongView,
    private readonly clock: Clock,
    private readonly now: () => number = Date.now
  ) {}

  update(state: PlayerState): void {
    const active = state.stationId === "rner3" && (state.status === "playing" || state.status === "buffering");
    if (this.disposed || this.active === active) return;
    this.active = active;
    const revision = ++this.revision;
    this.cancelRefresh?.();
    this.clear();
    if (active) {
      // Reutilizar al volver solo si conserva su caducidad original.
      if (this.latest && isFreshSong(this.latest, this.now())) this.show(this.latest, revision);
      void this.refresh(revision).catch(() => {});
    }
  }

  /** Consulta inmediata, compartida con cualquier sondeo que ya esté en curso. */
  async refreshNow(): Promise<CurrentSong | null> {
    if (this.disposed || !this.active) return null;
    const revision = this.revision;
    await this.refresh(revision);
    this.checkFreshness();
    return this.isCurrent(revision) ? this.visible : null;
  }

  /** Actualizaciones del propietario compartido, sin esperar al siguiente sondeo. */
  receive(song: CurrentSong | null): void {
    if (this.disposed || !this.active) return;
    this.received++;
    this.apply(song, this.revision);
  }

  /** Revalidar al recuperar visibilidad: los navegadores pueden retrasar timers. */
  checkFreshness(): void {
    if (this.visible && !isFreshSong(this.visible, this.now())) this.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.cancelRefresh?.();
    this.clear();
  }

  private refresh(revision: number): Promise<void> {
    if (this.pending?.revision === revision) return this.pending.promise;
    this.cancelRefresh?.();
    this.cancelRefresh = undefined;
    const promise = this.load(revision).finally(() => {
      if (this.pending?.promise === promise) this.pending = undefined;
    });
    this.pending = { revision, promise };
    return promise;
  }
  private async load(revision: number): Promise<void> {
    let failure: Error | undefined;
    const receivedAt = this.received;
    try {
      const song = await this.provider.getCurrent();
      if (!this.isCurrent(revision)) return;
      // Un snapshot lento no puede borrar una actualización recibida después.
      if (receivedAt === this.received) this.apply(song, revision);
    } catch (error) {
      if (!this.isCurrent(revision)) return;
      if (receivedAt === this.received) this.apply(null, revision);
      failure = error instanceof Error ? error : new Error("No se pudo consultar la canción.");
    }
    if (this.isCurrent(revision)) {
      this.cancelRefresh = this.clock.after(15000, () => { void this.refresh(revision).catch(() => {}); });
    }
    if (failure) throw failure;
  }
  private apply(song: CurrentSong | null, revision: number): void {
    this.latest = song && isFreshSong(song, this.now()) ? song : null;
    if (this.latest) {
      this.cancelExpiry?.();
      this.show(this.latest, revision);
    } else this.clear();
  }
  private show(song: CurrentSong, revision: number): void {
    this.visible = song;
    this.view.renderSong(song);
    // Independiente del sondeo: una petición pendiente no prolonga la canción.
    this.cancelExpiry = this.clock.after(song.expiresAt - this.now(), () => {
      if (this.isCurrent(revision) && this.visible === song) this.clear();
    });
  }
  private clear(): void {
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
    this.visible = null;
    this.view.renderSong(null);
  }
  private isCurrent(revision: number): boolean {
    return !this.disposed && this.active && revision === this.revision;
  }
}
