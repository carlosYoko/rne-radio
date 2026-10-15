import type { RadioPlayer } from "../../application/radio-player.js";
import { getStation } from "../../domain/stations.js";

export function connectMediaSession(player: RadioPlayer, session: MediaSession | undefined): void {
  if (!session) return;
  session.setActionHandler("play", () => { void player.execute({ type: "PLAY" }); });
  session.setActionHandler("pause", () => { void player.execute({ type: "STOP" }); });
  session.setActionHandler("stop", () => { void player.execute({ type: "STOP" }); });
  player.subscribe((state) => {
    session.metadata = new MediaMetadata({
      title: getStation(state.stationId)!.name,
      artist: "RNE · Emisión en directo"
    });
    session.playbackState = state.status === "playing" ? "playing" : "paused";
  });
}
