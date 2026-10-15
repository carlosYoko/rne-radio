import type { SettingsRepository } from "../../application/ports.js";
import { isRecord, normalizeSettings, type Settings } from "../../domain/player.js";
import { sendMessage } from "./messages.js";

/** Solo el service worker accede a storage; offscreen no dispone de esa API. */
export class ChromeSettingsRepository implements SettingsRepository {
  async load(): Promise<Settings> {
    return normalizeSettings(await chrome.storage.local.get(["stationId", "volume"]));
  }
  async save(settings: Settings): Promise<void> {
    await chrome.storage.local.set(settings);
  }
}

export class RemoteSettingsRepository implements SettingsRepository {
  async load(): Promise<Settings> {
    return normalizeSettings(await sendMessage({ target: "background", type: "LOAD_SETTINGS" }));
  }
  async save(settings: Settings): Promise<void> {
    const response = await sendMessage({ target: "background", type: "SAVE_SETTINGS", settings });
    if (!isRecord(response) || response.ok !== true) throw new Error("No se han podido guardar los ajustes.");
  }
}
