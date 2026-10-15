import { isPlayerCommand, isPlayerState, isRecord, isFiniteNumber, type PlayerCommand, type PlayerState, type Settings } from "../../domain/player.js";
import { isStationId, type StationId } from "../../domain/stations.js";
import { isCurrentProgram, type CurrentProgram } from "../../domain/program.js";
import { isCurrentSong, type CurrentSong } from "../../domain/song.js";

import { isToolbarMetadata, type ToolbarMetadata } from "../../domain/toolbar-metadata.js";

export type BackgroundMessage =
  | { target: "background"; type: "GET_PLAYBACK_METADATA" }
  | { target: "background"; type: "REFRESH_PLAYBACK_SONG" }
  | { target: "background"; type: "UPDATE_METADATA"; metadata: ToolbarMetadata }
  | { target: "background"; type: "GET_SONG"; stationId: "rner3" }
  | { target: "background"; type: "GET_PROGRAM"; stationId: StationId }
  | { target: "background"; type: "LOAD_SETTINGS" }
  | { target: "background"; type: "SAVE_SETTINGS"; settings: Settings }
  | { target: "background"; type: "COMMAND"; command: PlayerCommand }
  | { target: "background"; type: "STATE_CHANGED"; state: PlayerState };
export type PlayerMessage = { target: "player"; command: PlayerCommand } | { target: "player"; type: "GET_METADATA" | "REFRESH_SONG" };
export type PopupMessage = { target: "popup"; type: "STATE_CHANGED"; state: PlayerState }
  | { target: "popup"; type: "METADATA_CHANGED"; metadata: ToolbarMetadata };
export type Message = BackgroundMessage | PlayerMessage | PopupMessage;
export type StateResponse = { state: PlayerState } | { error: string };
export type ProgramResponse = { program: CurrentProgram | null } | { error: string };
export type SongResponse = { song: CurrentSong | null } | { error: string };
export type MetadataResponse = { metadata: ToolbarMetadata | null } | { error: string };
export type BackgroundResponse = StateResponse | ProgramResponse | SongResponse | MetadataResponse | Settings | { ok: boolean };

/** TypeScript no valida los mensajes en ejecución: comprobar también el límite externo. */
export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!isRecord(value) || value.target !== "background") return false;
  switch (value.type) {
    case "GET_PLAYBACK_METADATA":
    case "REFRESH_PLAYBACK_SONG": return true;
    case "UPDATE_METADATA": return isToolbarMetadata(value.metadata);
    case "GET_SONG": return value.stationId === "rner3";
    case "GET_PROGRAM": return isStationId(value.stationId);
    case "LOAD_SETTINGS": return true;
    case "SAVE_SETTINGS": return isRecord(value.settings) && isStationId(value.settings.stationId)
      && isFiniteNumber(value.settings.volume) && value.settings.volume >= 0 && value.settings.volume <= 1;
    case "COMMAND": return isPlayerCommand(value.command);
    case "STATE_CHANGED": return isPlayerState(value.state);
    default: return false;
  }
}
export function isPlayerMessage(value: unknown): value is PlayerMessage {
  return isRecord(value) && value.target === "player"
    && ("type" in value ? (value.type === "GET_METADATA" || value.type === "REFRESH_SONG") && !("command" in value) : isPlayerCommand(value.command));
}
export function isPopupMessage(value: unknown): value is PopupMessage {
  if (!isRecord(value) || value.target !== "popup") return false;
  return (value.type === "STATE_CHANGED" && isPlayerState(value.state))
    || (value.type === "METADATA_CHANGED" && isToolbarMetadata(value.metadata));
}
export function readStateResponse(value: unknown): PlayerState {
  if (isRecord(value) && typeof value.error === "string") throw new Error(value.error);
  if (!isRecord(value) || !isPlayerState(value.state)) throw new Error("El reproductor no ha respondido correctamente.");
  return value.state;
}
export function readProgramResponse(value: unknown): CurrentProgram | null {
  if (isRecord(value) && typeof value.error === "string") throw new Error(value.error);
  if (!isRecord(value) || (value.program !== null && !isCurrentProgram(value.program))) {
    throw new Error("La programación no ha respondido correctamente.");
  }
  return value.program;
}
export function readSongResponse(value: unknown): CurrentSong | null {
  if (isRecord(value) && typeof value.error === "string") throw new Error(value.error);
  if (!isRecord(value) || (value.song !== null && !isCurrentSong(value.song))) {
    throw new Error("La información musical no ha respondido correctamente.");
  }
  return value.song;
}
export function readMetadataResponse(value: unknown): ToolbarMetadata | null {
  if (isRecord(value) && typeof value.error === "string") throw new Error(value.error);
  if (!isRecord(value) || (value.metadata !== null && !isToolbarMetadata(value.metadata))) {
    throw new Error("Los metadatos del reproductor no han respondido correctamente.");
  }
  return value.metadata;
}
export function sendMessage(message: Message): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}
export function notify(message: Message): void {
  // Puede no existir un popup abierto: no es un error de reproducción.
  void sendMessage(message).catch(() => {});
}
