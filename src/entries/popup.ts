import { SongRequestController } from "../application/song-request-controller.js";
import { SongController } from "../application/song-controller.js";
import { RuntimePlaybackSongClient } from "../infrastructure/chrome/playback-song-client.js";
import { StationProgramsController } from "../application/station-programs-controller.js";
import { STATIONS } from "../domain/stations.js";
import { RuntimeProgramClient } from "../infrastructure/chrome/program-client.js";
import { PopupController } from "../application/popup-controller.js";
import { browserClock } from "../infrastructure/audio/html-audio.js";
import { RuntimePlayerClient } from "../infrastructure/chrome/player-client.js";
import { isPopupMessage } from "../infrastructure/chrome/messages.js";
import { PopupView } from "../presentation/popup-view.js";

const view = new PopupView(document);
const programs = new StationProgramsController(STATIONS.map((station) => station.id), new RuntimeProgramClient(), view, browserClock);
const songClient = new RuntimePlaybackSongClient();
const songs = new SongController(songClient, view, browserClock);
const songRequest = new SongRequestController(songClient, view);
const controller = new PopupController(new RuntimePlayerClient(), view, browserClock,
  (state) => {
    programs.select(state.stationId);
    songs.update(state);
    songRequest.update(state);
  });
view.bind({
  toggle: () => { void controller.toggle(); },
  requestSong: () => { void songRequest.request(); },
  selectStation: (stationId) => { void controller.command({ type: "SELECT_STATION", payload: { stationId } }); },
  setVolume: (volume, immediate) => controller.setVolume(volume, immediate)
});
chrome.runtime.onMessage.addListener((value: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !isPopupMessage(value)) return;
  if (value.type === "STATE_CHANGED") controller.receive(value.state);
  else {
    songs.receive(value.metadata.song);
    songRequest.receive(value.metadata.song);
  }
});
window.addEventListener("pagehide", () => {
  controller.dispose();
  programs.dispose();
  songs.dispose();
  songRequest.dispose();
}, { once: true });
document.addEventListener("visibilitychange", () => songs.checkFreshness());
window.addEventListener("focus", () => songs.checkFreshness());
programs.start();
void controller.start();
