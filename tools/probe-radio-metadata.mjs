// Investigación manual, fuera de la extensión. No modifica preferencias ni reproducción.
// Ejemplo: node tools/probe-radio-metadata.mjs rner3,rnerc 60
import { STATIONS, getStation, streamUrl } from "../build/domain/stations.js";

const ids = (process.argv[2] ?? "rner3").split(",");
const seconds = Number(process.argv[3] ?? 30);
if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120 || ids.some((id) => !getStation(id))) {
  throw new Error(`Uso: node tools/probe-radio-metadata.mjs <ids separados por coma> <5..120 segundos>. IDs: ${STATIONS.map((station) => station.id).join(", ")}`);
}

async function probe(id) {
  const source = streamUrl(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  const report = {
    stationId: id, source, startedAt: new Date().toISOString(), requestedSeconds: seconds,
    status: null, headers: {}, bytesReceived: 0, metadataIntervals: 0,
    nonEmptyPackets: 0, uniqueMetadata: [], error: null
  };
  let reader;
  try {
    const response = await fetch(source, {
      headers: { "Icy-MetaData": "1" }, signal: controller.signal
    });
    report.status = response.status;
    report.headers = Object.fromEntries(["content-type", "icy-name", "icy-metaint", "icy-br"]
      .map((name) => [name, response.headers.get(name)]));
    if (!response.ok || !response.body) throw new Error(`Respuesta HTTP ${response.status}`);
    const interval = Number(response.headers.get("icy-metaint"));
    if (!Number.isSafeInteger(interval) || interval <= 0 || interval > 1024 * 1024) {
      await response.body.cancel();
      report.error = "La respuesta no ofrece un intervalo ICY válido.";
      return report;
    }
    reader = response.body.getReader();
    let pending = Buffer.alloc(0);
    const metadata = new Set();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      report.bytesReceived += value.byteLength;
      pending = Buffer.concat([pending, value]);
      while (pending.length >= interval + 1) {
        const length = pending[interval] * 16;
        const packetLength = interval + 1 + length;
        if (pending.length < packetLength) break;
        report.metadataIntervals++;
        if (length > 0) {
          report.nonEmptyPackets++;
          const text = pending.subarray(interval + 1, packetLength).toString("utf8").replace(/\0+$/, "");
          metadata.add(text);
        }
        pending = pending.subarray(packetLength);
      }
      report.uniqueMetadata = [...metadata];
    }
  } catch (error) {
    // Agotar el periodo de observación es normal; un fallo HTTP o de red no lo es.
    if (!controller.signal.aborted) report.error = error.message;
    else if (report.status === null) report.error = "No se recibió una respuesta HTTP dentro del tiempo de observación.";
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

console.log(JSON.stringify(await Promise.all(ids.map(probe)), null, 2));
