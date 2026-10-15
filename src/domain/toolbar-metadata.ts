import { isRecord } from "./player.js";
import { isStationId, getStation, type StationId } from "./stations.js";
import { isCurrentProgram, type CurrentProgram } from "./program.js";
import { isCurrentSong, isFreshSong, type CurrentSong } from "./song.js";

export interface ToolbarMetadata {
  stationId: StationId;
  program: CurrentProgram | null;
  song: CurrentSong | null;
}
export function isToolbarMetadata(value: unknown): value is ToolbarMetadata {
  return isRecord(value) && isStationId(value.stationId)
    && (value.program === null || (isCurrentProgram(value.program) && value.program.stationId === value.stationId))
    && (value.song === null || (isCurrentSong(value.song) && value.song.stationId === value.stationId));
}
export function toolbarTitle(metadata: ToolbarMetadata, now: number): string {
  const lines = [`RNE · ${getStation(metadata.stationId)!.name}`];
  if (metadata.program?.stationId === metadata.stationId && metadata.program.expiresAt > now) lines.push(`Programa: ${metadata.program.title}`);
  if (metadata.song?.stationId === metadata.stationId && isFreshSong(metadata.song, now)) {
    lines.push(`${metadata.song.title} — ${metadata.song.artists.join(" · ")}`);
  }
  return lines.join("\n");
}
