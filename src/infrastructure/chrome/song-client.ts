import type { SongProvider } from "../../application/ports.js";
import type { CurrentSong } from "../../domain/song.js";
import { readSongResponse, sendMessage } from "./messages.js";

export class RuntimeSongClient implements SongProvider {
  async getCurrent(): Promise<CurrentSong | null> {
    return readSongResponse(await sendMessage({ target: "background", type: "GET_SONG", stationId: "rner3" }));
  }
}
