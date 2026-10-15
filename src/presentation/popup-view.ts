import type { PlayerView, StationProgramsView, SongView, SongRequestState, SongRequestView } from "../application/ports.js";
import type { ProgramState } from "../domain/program.js";
import type { CurrentSong } from "../domain/song.js";
import { isActive, type PlaybackStatus, type PlayerState } from "../domain/player.js";
import { STATIONS, getStation, type StationId } from "../domain/stations.js";

interface ViewActions {
  toggle(): void;
  requestSong(): void;
  selectStation(id: StationId): void;
  setVolume(volume: number, immediate: boolean): void;
}
const STATUS_LABELS: Record<PlaybackStatus, string> = {
  stopped: "Listo para escuchar", loading: "Conectando con el directo…",
  buffering: "Recuperando señal…", playing: "Escuchando en directo", error: "Señal no disponible"
};

export class PopupView implements PlayerView, StationProgramsView, SongView, SongRequestView {
  private playerBusy = false;
  private songRequestEnabled = false;
  private readonly play: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly output: HTMLOutputElement;
  private readonly stations: HTMLElement;

  constructor(private readonly document: Document) {
    this.play = this.element<HTMLButtonElement>("play");
    this.volume = this.element<HTMLInputElement>("volume");
    this.output = this.element<HTMLOutputElement>("volume-value");
    this.stations = this.element("stations");
  }

  bind(actions: ViewActions): void {
    this.stations.replaceChildren();
    for (const station of STATIONS) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "station";
      button.dataset.id = station.id;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `Seleccionar ${station.name}`);
      button.disabled = true;
      const mark = this.document.createElement("span");
      mark.className = "station-mark";
      mark.style.color = station.color;
      mark.setAttribute("aria-hidden", "true");
      const logo = this.document.createElement("img");
      logo.src = station.logo;
      logo.alt = "";
      logo.width = 44;
      logo.height = 38;
      mark.append(logo);
      const copy = this.document.createElement("span");
      copy.className = "station-copy";
      const title = this.document.createElement("span");
      title.className = "station-title";
      title.textContent = station.name;
      const description = this.document.createElement("span");
      description.className = "station-description";
      description.textContent = station.description;
      copy.append(title, description);
      const indicator = this.document.createElement("span");
      indicator.className = "station-indicator";
      indicator.textContent = "•";
      indicator.setAttribute("aria-hidden", "true");
      button.append(mark, copy, indicator);
      button.addEventListener("click", () => actions.selectStation(station.id));
      this.stations.append(button);
    }
    this.play.addEventListener("click", () => actions.toggle());
    this.element("request-song").addEventListener("click", () => actions.requestSong());
    this.volume.addEventListener("input", () => {
      this.output.value = `${this.volume.value}%`;
      actions.setVolume(Number(this.volume.value) / 100, false);
    });
    this.volume.addEventListener("change", () => actions.setVolume(Number(this.volume.value) / 100, true));
  }

  render(state: PlayerState, busy: boolean): void {
    const station = getStation(state.stationId)!;
    const active = isActive(state.status);
    this.element("station-name").textContent = station.name;
    const logo = this.element<HTMLImageElement>("station-logo");
    if (logo.getAttribute("src") !== station.logo) logo.src = station.logo;
    this.element("station-art").style.borderColor = station.color;
    this.element("status").textContent = STATUS_LABELS[state.status];
    this.play.setAttribute("aria-label", active ? "Detener reproducción" : "Reproducir en directo");
    // SVGElement no implementa HTMLElement.hidden: cambiar el atributo real.
    this.element("play-icon").toggleAttribute("hidden", active);
    this.element("stop-icon").toggleAttribute("hidden", !active);
    if (this.document.activeElement !== this.volume) {
      this.volume.value = String(Math.round(state.volume * 100));
      this.output.value = `${this.volume.value}%`;
    }
    const error = this.element("error");
    error.textContent = state.error;
    error.hidden = !state.error;
    for (const button of this.stationButtons()) {
      button.setAttribute("aria-pressed", String(button.dataset.id === station.id));
    }
    this.setBusy(busy, true);
  }

  renderProgram(state: ProgramState): void {
    const container = this.element("current-program");
    container.dataset.status = state.status;
    container.setAttribute("aria-busy", String(state.status === "loading"));
    this.element("program-name").textContent = state.status === "ready"
      ? state.program.title
      : state.status === "loading" ? "Consultando programación…" : "Programación no disponible";
    const details = this.element("program-details");
    details.textContent = state.status === "ready"
      ? [state.program.presenter, `${state.program.startTime}–${state.program.endTime} · hora peninsular`].filter(Boolean).join(" · ")
      : "";
    details.hidden = state.status !== "ready";
  }

  renderSong(song: CurrentSong | null): void {
    this.element("current-song").hidden = song === null;
    this.element("song-title").textContent = song?.title ?? "";
    this.element("song-artists").textContent = song?.artists.join(" · ") ?? "";
  }

  renderSongRequest(state: SongRequestState): void {
    const container = this.element("song-request");
    container.hidden = !state.visible;
    container.setAttribute("aria-busy", String(state.busy));
    this.songRequestEnabled = state.enabled;
    const button = this.element<HTMLButtonElement>("request-song");
    button.disabled = !state.enabled || this.playerBusy;
    button.textContent = state.busy ? "Consultando…" : "Obtener título de canción";
    const message = this.element("song-request-message");
    message.textContent = state.message;
    message.hidden = !state.message;
  }

  renderStationProgram(stationId: StationId, state: ProgramState): void {
    const button = this.stations.querySelector<HTMLButtonElement>(`button[data-id="${stationId}"]`);
    const description = button?.querySelector<HTMLElement>(".station-description");
    if (!button || !description) return;
    const station = getStation(stationId)!;
    const title = state.status === "ready" ? state.program.title : station.description;
    description.textContent = title;
    description.title = title;
    description.classList.toggle("is-program", state.status === "ready");
    button.dataset.programStatus = state.status;
    button.setAttribute("aria-label", state.status === "ready"
      ? `Seleccionar ${station.name}. Ahora: ${title}` : `Seleccionar ${station.name}`);
  }

  setBusy(busy: boolean, ready: boolean): void {
    this.playerBusy = busy;
    this.element<HTMLButtonElement>("request-song").disabled = busy || !ready || !this.songRequestEnabled;
    this.play.disabled = busy || !ready;
    this.volume.disabled = !ready;
    for (const button of this.stationButtons()) button.disabled = busy || !ready;
  }
  showError(message: string): void {
    const error = this.element("error");
    error.textContent = message;
    error.hidden = false;
  }
  private stationButtons(): NodeListOf<HTMLButtonElement> {
    return this.stations.querySelectorAll<HTMLButtonElement>("button.station");
  }
  private element<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.document.querySelector<T>(`#${id}`);
    if (!element) throw new Error(`Falta el elemento #${id} en popup.html`);
    return element;
  }
}
