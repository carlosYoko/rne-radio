import { type PlayerCommand, type PlayerState, type Settings } from "../domain/player.js";
import type { PlayerHost, SettingsRepository, Toolbar } from "./ports.js";

/** Coordina preferencias, host de audio y barra, sin conocer las APIs de Chrome. */
export class BackgroundService {
  private revision = 0;
  constructor(private readonly settings: SettingsRepository, private readonly player: PlayerHost, private readonly toolbar: Toolbar) {}

  async restoreIcon(): Promise<void> {
    const revision = this.revision;
    const saved = await this.settings.load();
    if (revision === this.revision) await this.toolbar.showStation(saved.stationId);
  }
  async initialize(): Promise<void> {
    await this.restoreIcon();
  }
  loadSettings(): Promise<Settings> { return this.settings.load(); }
  async saveSettings(settings: Settings): Promise<void> {
    await this.settings.save(settings);
    // El evento STATE_CHANGED es la fuente del icono: no usar escrituras antiguas
    // del volumen para sobrescribir la selección actual.
  }
  async execute(command: PlayerCommand): Promise<PlayerState> {
    const revision = this.revision;
    const state = await this.player.execute(command);
    if (revision === this.revision) await this.showStation(state);
    return state;
  }
  async stateChanged(state: PlayerState): Promise<void> {
    await this.showStation(state);
  }
  private async showStation(state: PlayerState): Promise<void> {
    this.revision++;
    // Un fallo cosmético de la barra no debe interrumpir la reproducción.
    await this.toolbar.showStation(state.stationId).catch(() => {});
  }
}
