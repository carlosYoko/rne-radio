import type { ProgramState } from "../domain/program.js";
import type { StationId } from "../domain/stations.js";
import type { Clock, ProgramProvider, StationProgramsView } from "./ports.js";
import { ProgramController } from "./program-controller.js";

/** Comparte cada consulta entre la fila de emisora y el programa seleccionado. */
export class StationProgramsController {
  private readonly controllers = new Map<StationId, ProgramController>();
  private readonly states = new Map<StationId, ProgramState>();
  private selected: StationId | undefined;
  private started = false;
  private disposed = false;

  constructor(
    stationIds: readonly StationId[],
    provider: ProgramProvider,
    private readonly view: StationProgramsView,
    clock: Clock,
    private readonly now: () => number = Date.now
  ) {
    for (const id of stationIds) {
      this.controllers.set(id, new ProgramController(provider, {
        renderProgram: (state) => {
          this.states.set(id, state);
          view.renderStationProgram(id, state);
          if (this.selected === id) view.renderProgram(state);
        }
      }, clock, now));
    }
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    for (const [id, controller] of this.controllers) controller.select(id);
  }

  select(stationId: StationId): void {
    if (this.disposed || this.selected === stationId || !this.controllers.has(stationId)) return;
    this.selected = stationId;
    this.start();
    const state = this.states.get(stationId);
    // No mostrar un título vencido aunque el navegador haya retrasado un timer.
    this.view.renderProgram(state && (state.status !== "ready" || state.program.expiresAt > this.now())
      ? state : { status: "loading", program: null });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.dispose();
    this.states.clear();
  }
}
