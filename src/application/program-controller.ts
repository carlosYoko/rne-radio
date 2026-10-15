import type { StationId } from "../domain/stations.js";
import type { Clock, ProgramProvider, ProgramView } from "./ports.js";

/** Consulta de parrilla con ciclo de vida explícito, independiente del worker. */
export class ProgramController {
  private stationId: StationId | undefined;
  private revision = 0;
  private disposed = false;
  private cancelRefresh: (() => void) | undefined;

  constructor(
    private readonly provider: ProgramProvider,
    private readonly view: ProgramView,
    private readonly clock: Clock,
    private readonly now: () => number = Date.now
  ) {}

  select(stationId: StationId): void {
    if (this.disposed || this.stationId === stationId) return;
    this.stationId = stationId;
    this.cancelTimers();
    const revision = ++this.revision;
    this.view.renderProgram({ status: "loading", program: null });
    void this.refresh(stationId, revision);
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.cancelTimers();
  }

  private async refresh(stationId: StationId, revision: number): Promise<void> {
    let delay = 60000;
    let expiresAt = Infinity;
    try {
      const program = await this.provider.getCurrent(stationId);
      if (!this.isCurrent(revision)) return;
      if (program && program.stationId === stationId && program.expiresAt > this.now()) {
        this.view.renderProgram({ status: "ready", program });
        expiresAt = program.expiresAt;
        delay = Math.min(delay, expiresAt - this.now());
      } else this.view.renderProgram({ status: "unavailable", program: null });
    } catch {
      if (!this.isCurrent(revision)) return;
      this.view.renderProgram({ status: "unavailable", program: null });
    }
    if (this.isCurrent(revision)) {
      this.cancelRefresh = this.clock.after(Math.max(1, delay), () => {
        if (!this.isCurrent(revision)) return;
        // Si vence al refrescar, ocultarlo antes de pedir el siguiente.
        if (this.now() >= expiresAt) this.view.renderProgram({ status: "loading", program: null });
        void this.refresh(stationId, revision);
      });
    }
  }

  private isCurrent(revision: number): boolean { return !this.disposed && revision === this.revision; }
  private cancelTimers(): void {
    this.cancelRefresh?.();
    this.cancelRefresh = undefined;
  }
}
