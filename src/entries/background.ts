import { BackgroundService } from "../application/background-service.js";
import { errorMessage, isRecord } from "../domain/player.js";
import { isBackgroundMessage, readMetadataResponse, readSongResponse, sendMessage, type BackgroundMessage, type BackgroundResponse } from "../infrastructure/chrome/messages.js";
import { ChromeSettingsRepository } from "../infrastructure/chrome/settings.js";
import { OffscreenPlayerHost } from "../infrastructure/chrome/player-client.js";
import { ChromeToolbar } from "../infrastructure/chrome/toolbar.js";

import { RtveProgramProvider } from "../infrastructure/rtve/program-provider.js";
import { RtveSongProvider } from "../infrastructure/rtve/song-provider.js";

const programs = new RtveProgramProvider();
const songs = new RtveSongProvider();
const toolbar = new ChromeToolbar();
const playerHost = new OffscreenPlayerHost();
const service = new BackgroundService(new ChromeSettingsRepository(), playerHost, toolbar);

async function handle(message: BackgroundMessage): Promise<BackgroundResponse> {
  switch (message.type) {
    case "REFRESH_PLAYBACK_SONG":
      await playerHost.ensure();
      return { song: readSongResponse(await sendMessage({ target: "player", type: "REFRESH_SONG" })) };
    case "GET_PLAYBACK_METADATA":
      await playerHost.ensure();
      return { metadata: readMetadataResponse(await sendMessage({ target: "player", type: "GET_METADATA" })) };
    case "UPDATE_METADATA":
      await restored;
      await toolbar.showMetadata(message.metadata);
      return { ok: true };
    case "GET_SONG": return { song: await songs.getCurrent() };
    case "GET_PROGRAM": return { program: await programs.getCurrent(message.stationId) };
    case "LOAD_SETTINGS": return service.loadSettings();
    case "SAVE_SETTINGS": await service.saveSettings(message.settings); return { ok: true };
    case "COMMAND": return { state: await service.execute(message.command) };
    case "STATE_CHANGED": await service.stateChanged(message.state); return { ok: true };
  }
}

// Los listeners deben registrarse de forma síncrona al evaluar el service worker.
chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isRecord(value) || value.target !== "background") return;
  if (!isBackgroundMessage(value)) { respond({ error: "Mensaje no válido." }); return; }
  void handle(value).then(respond, (error: unknown) => respond({ error: errorMessage(error) }));
  return true;
});
const initialize = () => { void service.initialize().catch(() => {}); };
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);
// Al despertar restaurar el logo seleccionado y limpiar badges antiguos.
const restored = service.restoreIcon().catch(() => {});
