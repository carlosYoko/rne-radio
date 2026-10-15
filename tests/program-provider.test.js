import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurrentProgram, RtveProgramProvider } from "../build/infrastructure/rtve/program-provider.js";
import { STATIONS } from "../build/domain/stations.js";

const NOW = Date.parse("2026-10-15T20:15:00Z"); // 22:15 en Madrid.
const item = { nombre: "El sótano", presentador: "Diego RJ", hora: "22:00", horaFin: "23:00", isNow: true, fechaInicio: "15-10-2026" };
function fixture(changes = {}, channel = "R3") {
  return { emisiones: [{ id: channel, programas: { items: [{ ...item, ...changes }] } }] };
}

test("interpreta programa y presentador con fin en hora peninsular", () => {
  assert.deepEqual(parseCurrentProgram(fixture(), "rner3", NOW), {
    stationId: "rner3", title: "El sótano", presenter: "Diego RJ", startTime: "22:00", endTime: "23:00",
    expiresAt: Date.parse("2026-10-15T21:00:00Z")
  });
});

test("rechaza estructuras rotas, datos caducados, otra emisora y campos inválidos", () => {
  for (const value of [null, {}, { emisiones: [] }, fixture({}, "R4"),
    fixture({ isNow: false }), fixture({ nombre: " " }), fixture({ hora: "bad" }),
    fixture({ horaFin: "23:80" }), fixture({ fechaInicio: "14-10-2026" }),
    fixture({ hora: "18:00", horaFin: "19:00" })]) {
    assert.equal(parseCurrentProgram(value, "rner3", NOW), null);
  }
});

test("admite presentador ausente, omisión de fecha y textos como texto plano", () => {
  const data = fixture({ presentador: null, fechaInicio: undefined, nombre: " <b>Programa</b> " });
  const program = parseCurrentProgram(data, "rner3", NOW);
  assert.equal(program.presenter, "");
  assert.equal(program.title, "<b>Programa</b>"); // La vista usa textContent, no innerHTML.
});

test("cruce de medianoche: valida la fecha de inicio del día anterior", () => {
  const midnight = Date.parse("2026-10-15T22:30:00Z"); // 00:30 del día 16 en Madrid.
  const data = fixture({ hora: "23:00", horaFin: "01:00" });
  const program = parseCurrentProgram(data, "rner3", midnight);
  assert.equal(program.expiresAt, Date.parse("2026-10-15T23:00:00Z"));
  assert.equal(parseCurrentProgram(fixture({ hora: "23:00", horaFin: "01:00", fechaInicio: "16-10-2026" }), "rner3", midnight), null);
});

test("el límite final excluye un programa ya terminado y acepta 24:00", () => {
  assert.equal(parseCurrentProgram(fixture(), "rner3", Date.parse("2026-10-15T21:00:00Z")), null);
  const program = parseCurrentProgram(fixture({ horaFin: "24:00" }), "rner3", NOW);
  assert.equal(program.endTime, "00:00");
  assert.equal(program.expiresAt, Date.parse("2026-10-15T22:00:00Z"));
});

test("respeta el cambio de horario de verano de Europe/Madrid", () => {
  const now = Date.parse("2026-03-29T00:30:00Z"); // 01:30 CET; 03:30 ya será CEST.
  const program = parseCurrentProgram(fixture({ hora: "01:00", horaFin: "03:30", fechaInicio: "29-03-2026" }), "rner3", now);
  assert.equal(program.expiresAt, Date.parse("2026-03-29T01:30:00Z"));
});

test("consulta las rutas correctas de las seis emisoras, sin cookies y con timeout", async () => {
  const channels = { rne1: "R1", rnerc: "R2", rner3: "R3", rner4: "R4", rne5: "R5", rneree: "R6" };
  const provider = new RtveProgramProvider(async function (url, options) {
    assert.equal(this, globalThis); // Regresión: fetch nativo exige el receptor global en workers.
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.ok(options.signal instanceof AbortSignal);
    const channel = Object.values(channels).find((id) => url.includes(`/${id}.json?emision=ahora-sig`));
    assert.ok(channel);
    return new Response(JSON.stringify(fixture({}, channel)));
  }, () => NOW);
  for (const station of STATIONS) assert.equal((await provider.getCurrent(station.id)).stationId, station.id);
});

test("single-flight y caché limitadas; no reutiliza un programa pasado su final", async () => {
  let calls = 0;
  let now = Date.parse("2026-10-15T20:59:50Z");
  const provider = new RtveProgramProvider(async () => {
    calls++;
    await Promise.resolve();
    return new Response(JSON.stringify(fixture()));
  }, () => now);
  await Promise.all([provider.getCurrent("rner3"), provider.getCurrent("rner3")]);
  await provider.getCurrent("rner3");
  assert.equal(calls, 1);
  now += 10000;
  assert.equal(await provider.getCurrent("rner3"), null);
  assert.equal(calls, 2);
});

test("errores HTTP o JSON permiten reintentar sin cachear el fallo", async () => {
  let calls = 0;
  const provider = new RtveProgramProvider(async () => {
    calls++;
    if (calls === 1) return new Response("error", { status: 503 });
    if (calls === 2) return new Response("not json");
    return new Response(JSON.stringify(fixture()));
  }, () => NOW);
  await assert.rejects(provider.getCurrent("rner3"), /503/);
  await assert.rejects(provider.getCurrent("rner3"));
  assert.equal((await provider.getCurrent("rner3")).title, "El sótano");
});
