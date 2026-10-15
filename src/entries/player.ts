import { PlaybackMetadataController } from "../application/playback-metadata-controller.js";
import { RuntimeProgramClient } from "../infrastructure/chrome/program-client.js";
import { RuntimeSongClient } from "../infrastructure/chrome/song-client.js";
import { RadioPlayer } from "../application/radio-player.js";
import { errorMessage, isRecord } from "../domain/player.js";
import { HtmlAudioEngine, browserClock } from "../infrastructure/audio/html-audio.js";
import { connectMediaSession } from "../infrastructure/audio/media-session.js";
import { isPlayerMessage, notify } from "../infrastructure/chrome/messages.js";
import { RemoteSettingsRepository } from "../infrastructure/chrome/settings.js";

const player = new RadioPlayer(new HtmlAudioEngine(), new RemoteSettingsRepository(), browserClock);
const metadata = new PlaybackMetadataController(new RuntimeProgramClient(), new RuntimeSongClient(), browserClock,
  (value) => {
    notify({ target: "background", type: "UPDATE_METADATA", metadata: value });
    notify({ target: "popup", type: "METADATA_CHANGED", metadata: value });
  });
player.subscribe((state) => {
  notify({ target: "background", type: "STATE_CHANGED", state });
  notify({ target: "popup", type: "STATE_CHANGED", state });
  metadata.update(state);
});
connectMediaSession(player, navigator.mediaSession);

chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isRecord(value) || value.target !== "player") return;
  if (!isPlayerMessage(value)) { respond({ error: "Acción no válida." }); return; }
  const command = "command" in value ? value.command : { type: "GET_STATE" } as const;
  void player.execute(command).then(async (state) => {
    // Reponer también los metadatos al reconectar, sin consultas duplicadas.
    if (command.type === "GET_STATE") metadata.update(state);
    if ("command" in value) return { state };
    if (value.type === "REFRESH_SONG") return { song: await metadata.refreshSong() };
    return { metadata: metadata.snapshot() };
  }).then(respond, (error: unknown) => respond({ error: errorMessage(error) }));
  return true;
});
