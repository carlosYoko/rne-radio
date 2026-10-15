import { errorMessage, isActive, type PlayerCommand, type PlayerState } from "../domain/player.js";
import type { Clock, PlayerClient, PlayerView } from "./ports.js";

/** Presentador: coordina la vista y las peticiones sin manipular el DOM. */
export class PopupController {
  private state: PlayerState | undefined;
  private busy = false;
  private revision = 0;
  private requestId = 0;
  private lastResponse = 0;
  private cancelVolume: (() => void) | undefined;

  constructor(
    private readonly client: PlayerClient,
    private readonly view: PlayerView,
    private readonly clock: Clock,
    private readonly onState: (state: PlayerState) => void = () => {}
  ) {}

  start(): Promise<void> { return this.command({ type: "GET_STATE" }); }
  toggle(): Promise<void> {
    return this.command({ type: this.state && isActive(this.state.status) ? "STOP" : "PLAY" });
  }
  receive(state: PlayerState): void {
    this.revision++;
    this.state = state;
    this.view.render(state, this.busy);
    this.onState(state);
  }
  setVolume(volume: number, immediate = false): void {
    this.cancelVolume?.();
    const send = () => { void this.command({ type: "SET_VOLUME", payload: { volume } }); };
    if (immediate) { this.cancelVolume = undefined; send(); }
    else this.cancelVolume = this.clock.after(100, send);
  }
  dispose(): void { this.cancelVolume?.(); }

  async command(command: PlayerCommand): Promise<void> {
    const exclusive = command.type !== "GET_STATE" && command.type !== "SET_VOLUME";
    if (exclusive && this.busy) return;
    const requestedAt = this.revision;
    const requestId = ++this.requestId;
    if (exclusive) this.busy = true;
    this.view.setBusy(this.busy, this.state !== undefined);
    try {
      const state = await this.client.execute(command);
      // Un evento más reciente o una respuesta posterior prevalecen al snapshot antiguo.
      if (requestedAt === this.revision && requestId > this.lastResponse) {
        this.lastResponse = requestId;
        this.state = state;
        this.view.render(state, this.busy);
        this.onState(state);
      }
    } catch (error) {
      this.view.showError(errorMessage(error));
    } finally {
      if (exclusive) this.busy = false;
      this.view.setBusy(this.busy, this.state !== undefined);
    }
  }
}
