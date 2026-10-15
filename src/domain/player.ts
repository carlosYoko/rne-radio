import { DEFAULT_STATION, isStationId, type StationId } from "./stations.js";

export const STATUSES = ["stopped", "loading", "playing", "buffering", "error"] as const;
export type PlaybackStatus = (typeof STATUSES)[number];
export interface Settings { stationId: StationId; volume: number }
export interface PlayerState extends Settings { status: PlaybackStatus; error: string }
export type PlayerCommand =
  | { type: "GET_STATE" }
  | { type: "PLAY" }
  | { type: "STOP" }
  | { type: "SELECT_STATION"; payload: { stationId: StationId } }
  | { type: "SET_VOLUME"; payload: { volume: number } };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function clampVolume(volume: number): number { return Math.max(0, Math.min(1, volume)); }
export function normalizeSettings(value: unknown): Settings {
  const data = isRecord(value) ? value : {};
  return {
    stationId: isStationId(data.stationId) ? data.stationId : DEFAULT_STATION.id,
    volume: isFiniteNumber(data.volume) ? clampVolume(data.volume) : 0.8
  };
}
export function isActive(status: PlaybackStatus): boolean {
  return status === "playing" || status === "loading" || status === "buffering";
}
export function isPlayerState(value: unknown): value is PlayerState {
  return isRecord(value) && isStationId(value.stationId) && isFiniteNumber(value.volume)
    && value.volume >= 0 && value.volume <= 1 && typeof value.error === "string"
    && STATUSES.some((status) => status === value.status);
}
export function isPlayerCommand(value: unknown): value is PlayerCommand {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "GET_STATE": case "PLAY": case "STOP": return true;
    case "SELECT_STATION": return isRecord(value.payload) && isStationId(value.payload.stationId);
    case "SET_VOLUME": return isRecord(value.payload) && isFiniteNumber(value.payload.volume);
    default: return false;
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Se ha producido un error inesperado.";
}
