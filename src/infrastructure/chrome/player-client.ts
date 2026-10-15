import type { PlayerClient, PlayerHost } from "../../application/ports.js";
import type { PlayerCommand, PlayerState } from "../../domain/player.js";
import { readStateResponse, sendMessage } from "./messages.js";

export class RuntimePlayerClient implements PlayerClient {
  async execute(command: PlayerCommand): Promise<PlayerState> {
    return readStateResponse(await sendMessage({ target: "background", type: "COMMAND", command }));
  }
}

export class OffscreenPlayerHost implements PlayerHost {
  private creating: Promise<void> | undefined;

  async ensure(): Promise<void> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL("offscreen.html")]
    });
    if (contexts.length) return;
    // Single-flight: varias peticiones comparten la misma creación.
    this.creating ??= chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Mantener la radio en directo al cerrar el popup."
    }).finally(() => { this.creating = undefined; });
    await this.creating;
  }
  async execute(command: PlayerCommand): Promise<PlayerState> {
    await this.ensure();
    return readStateResponse(await sendMessage({ target: "player", command }));
  }
}
