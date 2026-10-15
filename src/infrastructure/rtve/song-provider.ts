import type { SongProvider } from "../../application/ports.js";
import { isFiniteNumber, isRecord } from "../../domain/player.js";
import { isFreshSong, SONG_MAX_AGE_MS, type CurrentSong } from "../../domain/song.js";

function parseUtc(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const iso = value.replace(" ", "T") + "Z";
  const timestamp = Date.parse(iso);
  // Evitar normalizar fechas imposibles (p. ej. 30 de febrero).
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === iso.replace("Z", ".000Z") ? timestamp : null;
}

/** La fecha HTTP y el momento de descarga NO renuevan una identificación antigua. */
export function parseCurrentSong(data: unknown, now: number): CurrentSong | null {
  if (!isRecord(data) || !isRecord(data.status) || data.status.code !== 0
    || !isRecord(data.metadata) || data.metadata.type !== "realtime" || !Array.isArray(data.metadata.music)) return null;
  const detectedAt = parseUtc(data.metadata.timestamp_utc);
  if (detectedAt === null || detectedAt > now || now - detectedAt >= SONG_MAX_AGE_MS) return null;
  for (const item of data.metadata.music as unknown[]) {
    if (!isRecord(item) || typeof item.title !== "string" || !item.title.trim() || !Array.isArray(item.artists)) continue;
    const artists = item.artists.filter(isRecord)
      .map((artist) => typeof artist.name === "string" ? artist.name.trim().slice(0, 200) : "").filter(Boolean);
    if (!artists.length) continue;
    let expiresAt = detectedAt + SONG_MAX_AGE_MS;
    if (item.duration_ms !== undefined || item.play_offset_ms !== undefined) {
      if (!isFiniteNumber(item.duration_ms) || !isFiniteNumber(item.play_offset_ms)
        || item.duration_ms <= 0 || item.play_offset_ms < 0 || item.play_offset_ms >= item.duration_ms) continue;
      expiresAt = Math.min(expiresAt, detectedAt + item.duration_ms - item.play_offset_ms);
    }
    const song: CurrentSong = {
      stationId: "rner3", title: item.title.trim().slice(0, 200), artists: [...new Set(artists)], detectedAt, expiresAt
    };
    if (isFreshSong(song, now)) return song;
  }
  return null;
}

export class RtveSongProvider implements SongProvider {
  private pending: Promise<CurrentSong | null> | undefined;
  constructor(
    private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly now: () => number = Date.now
  ) {}
  async getCurrent(): Promise<CurrentSong | null> {
    this.pending ??= this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async load(): Promise<CurrentSong | null> {
    const response = await this.request.call(globalThis, "https://nowplaying.rtve.es/radio3.json", {
      signal: AbortSignal.timeout(5000), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store"
    });
    if (!response.ok) throw new Error(`RTVE música: HTTP ${response.status}`);
    const data: unknown = await response.json();
    return parseCurrentSong(data, this.now());
  }
}
