import { isFiniteNumber, isRecord } from "./player.js";
import { isStationId, type StationId } from "./stations.js";

/** Información de parrilla, independiente de la canción y del estado del audio. */
export interface CurrentProgram {
  stationId: StationId;
  title: string;
  presenter: string;
  startTime: string;
  endTime: string;
  expiresAt: number;
}
export type ProgramState =
  | { status: "loading" | "unavailable"; program: null }
  | { status: "ready"; program: CurrentProgram };

export function isCurrentProgram(value: unknown): value is CurrentProgram {
  return isRecord(value) && isStationId(value.stationId)
    && typeof value.title === "string" && value.title.trim().length > 0
    && typeof value.presenter === "string"
    && typeof value.startTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)
    && typeof value.endTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.endTime)
    && isFiniteNumber(value.expiresAt);
}
