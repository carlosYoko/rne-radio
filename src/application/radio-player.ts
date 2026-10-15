import { clampVolume, normalizeSettings, type PlayerCommand, type PlayerState } from "../domain/player.js";
import { isStationId, streamUrl } from "../domain/stations.js";
import type { AudioEngine, Clock, SettingsRepository } from "./ports.js";

/** Único propietario del estado de reproducción. No depende de Chrome ni del DOM. */
export class RadioPlayer {
  private state: PlayerState = { ...normalizeSettings({}), status: "stopped", error: "" };
  private readonly ready: Promise<void>;
  private readonly listeners = new Set<(state: PlayerState) => void>();
  private readonly unsubscribe: Array<() => void>;
  private generation = 0;
  private wantsPlayback = false;
  private cancelTimer: (() => void) | undefined;
  private saves: Promise<void> = Promise.resolve();

  constructor(private readonly audio: AudioEngine, private readonly settings: SettingsRepository, private readonly clock: Clock) {
    this.ready = settings.load().then((saved) => {
      Object.assign(this.state, normalizeSettings(saved));
    }).catch(() => { /* Usar valores por defecto si el almacenamiento no está disponible. */ })
      .then(() => { audio.setVolume(this.state.volume); });
    this.unsubscribe = [
      audio.on("playing", () => {
        if (!this.wantsPlayback) return;
        this.clearTimer();
        this.change("playing");
      }),
      audio.on("waiting", () => {
        if (!this.wantsPlayback) return;
        this.watchConnection();
        this.change("buffering");
      }),
      audio.on("error", () => {
        if (this.wantsPlayback) this.fail("La señal no está disponible o se ha interrumpido la conexión. Vuelve a intentarlo.");
      }),
      audio.on("ended", () => {
        if (this.wantsPlayback) this.fail("La emisión ha terminado o se ha desconectado. Pulsa reproducir para reconectar.");
      })
    ];
  }

  snapshot(): PlayerState { return { ...this.state }; }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async execute(command: PlayerCommand): Promise<PlayerState> {
    await this.ready;
    switch (command.type) {
      case "GET_STATE": break;
      case "PLAY": this.play(); break;
      case "STOP": this.stop(); break;
      case "SELECT_STATION": {
        if (!isStationId(command.payload.stationId)) throw new Error("Emisora no válida");
        // Seleccionar la señal actual no debe reiniciar audio ni metadatos.
        if (command.payload.stationId === this.state.stationId) break;
        this.state.stationId = command.payload.stationId;
        this.save();
        if (this.wantsPlayback) this.play();
        else this.change("stopped");
        break;
      }
      case "SET_VOLUME": {
        if (!Number.isFinite(command.payload.volume)) throw new Error("Volumen no válido");
        this.state.volume = clampVolume(command.payload.volume);
        this.audio.setVolume(this.state.volume);
        this.save();
        this.publish();
        break;
      }
    }
    return this.snapshot();
  }

  /** Facilita esperar la persistencia en pruebas o al añadir nuevos casos de uso. */
  async flushSettings(): Promise<void> { await this.saves; }

  dispose(): void {
    this.stop();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private change(status: PlayerState["status"], error = ""): void {
    this.state.status = status;
    this.state.error = error;
    this.publish();
  }
  private save(): void {
    const { stationId, volume } = this.state;
    // Mantener el orden de las escrituras aunque el usuario cambie rápidamente.
    this.saves = this.saves.then(() => this.settings.save({ stationId, volume })).catch(() => {});
  }
  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
  private watchConnection(): void {
    this.clearTimer();
    this.cancelTimer = this.clock.after(25000, () => {
      if (this.wantsPlayback) this.fail("La emisora no responde. Comprueba tu conexión y vuelve a intentarlo.");
    });
  }
  private play(): void {
    const current = ++this.generation;
    this.wantsPlayback = false;
    this.audio.release();
    this.wantsPlayback = true;
    this.change("loading");
    this.watchConnection();
    // No bloquear comandos mientras conecta. Ignorar rechazos de señales sustituidas.
    void this.audio.play(streamUrl(this.state.stationId)).catch((error: unknown) => {
      if (current !== this.generation) return;
      if (error instanceof Error && error.name === "AbortError") return;
      this.fail("No se puede reproducir esta señal. Prueba de nuevo o elige otra emisora.");
    });
  }
  private stop(): void {
    this.release();
    this.change("stopped");
  }
  private fail(error: string): void {
    this.release();
    this.change("error", error);
  }
  private release(): void {
    this.wantsPlayback = false;
    this.generation++;
    this.clearTimer();
    // Al reanudar, conectar con el directo y no con audio atrasado.
    this.audio.release();
  }
}
