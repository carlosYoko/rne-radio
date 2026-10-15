import type { PlayerCommand, PlayerState, Settings } from "../domain/player.js";
import type { StationId } from "../domain/stations.js";
import type { CurrentProgram, ProgramState } from "../domain/program.js";
import type { CurrentSong } from "../domain/song.js";

export interface SettingsRepository {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}
export type AudioEvent = "playing" | "waiting" | "error" | "ended";
export interface AudioEngine {
  play(url: string): Promise<void>;
  release(): void;
  setVolume(volume: number): void;
  on(event: AudioEvent, listener: () => void): () => void;
}
export interface Clock { after(milliseconds: number, callback: () => void): () => void }
export interface PlayerClient { execute(command: PlayerCommand): Promise<PlayerState> }
export interface PlayerHost extends PlayerClient { ensure(): Promise<void> }
export interface Toolbar {
  showStation(id: StationId): Promise<void>;
}
export interface ProgramProvider {
  getCurrent(stationId: StationId): Promise<CurrentProgram | null>;
}
export interface ProgramView {
  renderProgram(state: ProgramState): void;
}
export interface StationProgramsView extends ProgramView {
  renderStationProgram(stationId: StationId, state: ProgramState): void;
}
export interface SongProvider { getCurrent(): Promise<CurrentSong | null> }
export interface SongView { renderSong(song: CurrentSong | null): void }
export interface SongRefresher { refresh(): Promise<CurrentSong | null> }
export interface SongRequestState { visible: boolean; enabled: boolean; busy: boolean; message: string }
export interface SongRequestView { renderSongRequest(state: SongRequestState): void }
export interface PlayerView {
  render(state: PlayerState, busy: boolean): void;
  setBusy(busy: boolean, ready: boolean): void;
  showError(message: string): void;
}
