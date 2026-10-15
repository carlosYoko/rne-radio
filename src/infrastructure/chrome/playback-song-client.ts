import type { SongProvider, SongRefresher } from "../../application/ports.js";
import type { CurrentSong } from "../../domain/song.js";
import { readMetadataResponse, readSongResponse, sendMessage } from "./messages.js";

/** El popup lee la identificación de offscreen; no vuelve a consultar RTVE. */
export class RuntimePlaybackSongClient implements SongProvider, SongRefresher {
  async refresh(): Promise<CurrentSong | null> {
    return readSongResponse(await sendMessage({ target: "background", type: "REFRESH_PLAYBACK_SONG" }));
  }
  async getCurrent(): Promise<CurrentSong | null> {
    const metadata = readMetadataResponse(await sendMessage({ target: "background", type: "GET_PLAYBACK_METADATA" }));
    return metadata?.song ?? null;
  }
}
