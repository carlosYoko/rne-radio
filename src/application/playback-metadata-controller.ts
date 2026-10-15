import { isActive, type PlayerState } from "../domain/player.js";
import type { CurrentProgram, ProgramState } from "../domain/program.js";
import { isFreshSong, type CurrentSong } from "../domain/song.js";
import type { ToolbarMetadata } from "../domain/toolbar-metadata.js";
import type { Clock, ProgramProvider, SongProvider } from "./ports.js";
import { ProgramController } from "./program-controller.js";
import { SongController } from "./song-controller.js";

/** Vive con el audio: refresca y caduca el tooltip incluso sin popup ni worker activo. */
export class PlaybackMetadataController {
  private state: PlayerState | undefined;
  private disposed = false;
  private program: CurrentProgram | null = null;
  private song: CurrentSong | null = null;
  private programs: ProgramController | undefined;
  private readonly songs: SongController;

  constructor(
    private readonly programProvider: ProgramProvider,
    songProvider: SongProvider,
    private readonly clock: Clock,
    private readonly publish: (metadata: ToolbarMetadata) => void,
    now: () => number = Date.now
  ) {
    this.songs = new SongController(songProvider, { renderSong: (song) => {
      this.song = song;
      this.render();
    } }, clock, now);
    this.now = now;
  }
  private readonly now: () => number;

  update(state: PlayerState): void {
    if (this.disposed) return;
    if (this.state?.stationId !== state.stationId) {
      this.program = null;
      this.song = null;
    }
    this.state = state;
    if (isActive(state.status)) {
      this.programs ??= new ProgramController(this.programProvider, {
        renderProgram: (value: ProgramState) => {
          this.program = value.program;
          this.render();
        }
      }, this.clock, this.now);
      this.programs.select(state.stationId);
    } else {
      this.programs?.dispose();
      this.programs = undefined;
      this.program = null;
    }
    this.songs.update(state);
    this.render();
  }
  refreshSong(): Promise<CurrentSong | null> {
    return this.songs.refreshNow();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const state = this.state;
    this.state = undefined;
    this.programs?.dispose();
    this.songs.dispose();
    this.program = null;
    this.song = null;
    if (state) this.publish({ stationId: state.stationId, program: null, song: null });
  }
  /** Lectura compartida: abrir un popup no inicia otra consulta a RTVE. */
  snapshot(): ToolbarMetadata | null {
    if (!this.state) return null;
    const active = isActive(this.state.status);
    const now = this.now();
    return {
      stationId: this.state.stationId,
      program: active && this.program?.stationId === this.state.stationId && this.program.expiresAt > now ? this.program : null,
      song: active && this.song?.stationId === this.state.stationId && isFreshSong(this.song, now) ? this.song : null
    };
  }
  private render(): void {
    const metadata = this.snapshot();
    if (metadata) this.publish(metadata);
  }
}
