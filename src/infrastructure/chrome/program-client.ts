import type { ProgramProvider } from "../../application/ports.js";
import type { CurrentProgram } from "../../domain/program.js";
import type { StationId } from "../../domain/stations.js";
import { readProgramResponse, sendMessage } from "./messages.js";

export class RuntimeProgramClient implements ProgramProvider {
  async getCurrent(stationId: StationId): Promise<CurrentProgram | null> {
    const program = readProgramResponse(await sendMessage({ target: "background", type: "GET_PROGRAM", stationId }));
    if (program && program.stationId !== stationId) throw new Error("La programación corresponde a otra emisora.");
    return program;
  }
}
