import { isFiniteNumber, isRecord } from "./player.js";

export const SONG_MAX_AGE_MS = 60000;
export interface CurrentSong {
  stationId: "rner3";
  title: string;
  artists: string[];
  detectedAt: number;
  expiresAt: number;
}
export function isCurrentSong(value: unknown): value is CurrentSong {
  return isRecord(value) && value.stationId === "rner3"
    && typeof value.title === "string" && value.title.trim().length > 0
    && Array.isArray(value.artists) && value.artists.length > 0
    && value.artists.every((artist: unknown) => typeof artist === "string" && artist.trim().length > 0)
    && isFiniteNumber(value.detectedAt) && isFiniteNumber(value.expiresAt)
    && value.expiresAt > value.detectedAt && value.expiresAt <= value.detectedAt + SONG_MAX_AGE_MS;
}
export function isFreshSong(song: CurrentSong, now: number): boolean {
  return isCurrentSong(song) && song.detectedAt <= now && now < song.expiresAt;
}
