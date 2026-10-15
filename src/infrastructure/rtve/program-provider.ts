import type { ProgramProvider } from "../../application/ports.js";
import { isRecord } from "../../domain/player.js";
import type { CurrentProgram } from "../../domain/program.js";
import type { StationId } from "../../domain/stations.js";

const CHANNELS: Record<StationId, string> = {
  rne1: "R1", rnerc: "R2", rner3: "R3", rner4: "R4", rne5: "R5", rneree: "R6"
};
const madrid = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
const DAY = 86400000;
function wallTime(timestamp: number): number {
  const parts = Object.fromEntries(madrid.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}
function timeMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function sourceDate(day: number): string {
  const date = new Date(day);
  return `${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`;
}
/** Convertir el fin del programa de horario peninsular a UTC, incluidos cambios de offset. */
function resolveEnd(targetWallTime: number, now: number): number | null {
  let candidate = targetWallTime - (wallTime(now) - Math.floor(now / 1000) * 1000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const difference = targetWallTime - wallTime(candidate);
    if (difference === 0) return candidate > now ? candidate : null;
    candidate += difference;
  }
  return null; // Hora local inexistente o incoherente: mejor no mostrar un dato dudoso.
}

/** El esquema externo se trata como unknown; no confundir presentador con artista. */
export function parseCurrentProgram(data: unknown, stationId: StationId, now: number): CurrentProgram | null {
  if (!isRecord(data) || !Array.isArray(data.emisiones)) return null;
  const channel = data.emisiones.find((item: unknown) => isRecord(item) && item.id === CHANNELS[stationId]);
  if (!isRecord(channel) || !isRecord(channel.programas) || !Array.isArray(channel.programas.items)) return null;
  const local = new Date(wallTime(now));
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const item of channel.programas.items as unknown[]) {
    if (!isRecord(item) || item.isNow !== true || typeof item.nombre !== "string" || !item.nombre.trim()) continue;
    const start = timeMinutes(item.hora);
    const endTime = item.horaFin === "24:00" ? "00:00" : item.horaFin;
    const end = timeMinutes(endTime);
    if (start === null || end === null || typeof item.hora !== "string" || typeof endTime !== "string") continue;
    const overnight = start >= end;
    const inRange = overnight ? minute >= start || minute < end : minute >= start && minute < end;
    if (!inRange) continue;
    const startedYesterday = overnight && minute < end;
    const startDay = today - (startedYesterday ? DAY : 0);
    if (item.fechaInicio !== undefined && item.fechaInicio !== sourceDate(startDay)) continue;
    const endDay = today + (overnight && !startedYesterday ? DAY : 0);
    const expiresAt = resolveEnd(endDay + end * 60000, now);
    if (expiresAt === null) continue;
    return {
      stationId, title: item.nombre.trim().slice(0, 200),
      presenter: typeof item.presentador === "string" ? item.presentador.trim().slice(0, 200) : "",
      startTime: item.hora, endTime, expiresAt
    };
  }
  return null;
}

export class RtveProgramProvider implements ProgramProvider {
  private readonly cache = new Map<StationId, { until: number; program: CurrentProgram | null }>();
  private readonly pending = new Map<StationId, Promise<CurrentProgram | null>>();
  // Conservar el receptor global: fetch usado como método de la instancia falla en workers.
  constructor(
    private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly now: () => number = Date.now
  ) {}

  async getCurrent(stationId: StationId): Promise<CurrentProgram | null> {
    const cached = this.cache.get(stationId);
    if (cached && cached.until > this.now()) return cached.program;
    const pending = this.pending.get(stationId);
    if (pending) return pending;
    const operation = this.load(stationId).finally(() => { this.pending.delete(stationId); });
    this.pending.set(stationId, operation);
    return operation;
  }
  private async load(stationId: StationId): Promise<CurrentProgram | null> {
    const url = `https://www.rtve.es/servicios/programasRadio/${CHANNELS[stationId]}.json?emision=ahora-sig`;
    const response = await this.request.call(globalThis, url, {
      signal: AbortSignal.timeout(8000), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error(`RTVE: HTTP ${response.status}`);
    const data: unknown = await response.json();
    const now = this.now();
    const program = parseCurrentProgram(data, stationId, now);
    this.cache.set(stationId, {
      program, until: Math.min(now + (program ? 45000 : 15000), program?.expiresAt ?? Infinity)
    });
    return program;
  }
}
