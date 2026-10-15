import { test } from "node:test";
import assert from "node:assert/strict";
import { StationProgramsController } from "../build/application/station-programs-controller.js";

const NOW = 1000000;
const makeProgram = (stationId, title = `Programa ${stationId}`) => ({
  stationId, title, presenter: "Presentador", startTime: "22:00", endTime: "23:00", expiresAt: NOW + 120000
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(getCurrent = async (id) => makeProgram(id)) {
  const calls = [], rows = new Map(), selected = [], timers = new Set();
  let now = NOW;
  const controller = new StationProgramsController(["rne1", "rner3", "rner4"], {
    getCurrent: (id) => { calls.push(id); return getCurrent(id); }
  }, {
    renderStationProgram: (id, state) => rows.set(id, state),
    renderProgram: (state) => selected.push(state)
  }, { after(ms, callback) {
    timers.add(callback);
    return () => timers.delete(callback);
  } }, () => now);
  return { controller, calls, rows, selected, timers, setNow: (value) => { now = value; } };
}

test("carga programas para todas las filas sin tener que seleccionar emisoras", async () => {
  const h = harness();
  h.controller.start();
  await flush();
  assert.deepEqual(h.calls, ["rne1", "rner3", "rner4"]);
  assert.equal(h.rows.size, 3);
  assert.equal(h.rows.get("rner3").program.title, "Programa rner3");
  assert.equal(h.selected.length, 0);
  assert.equal(h.timers.size, 3);
});

test("seleccionar reutiliza los datos de la fila sin duplicar peticiones ni timers", async () => {
  const h = harness();
  h.controller.start();
  await flush();
  h.controller.select("rner3");
  assert.equal(h.selected.at(-1).program.stationId, "rner3");
  h.controller.select("rner4");
  assert.equal(h.selected.at(-1).program.stationId, "rner4");
  h.controller.select("rner4");
  h.controller.start();
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 3);
});

test("las respuestas tardías de otras filas no cambian el programa seleccionado", async () => {
  const respond = new Map();
  const h = harness((id) => new Promise((resolve) => respond.set(id, resolve)));
  h.controller.select("rner3");
  h.controller.select("rner4");
  respond.get("rner4")(makeProgram("rner4"));
  await flush();
  respond.get("rner3")(makeProgram("rner3"));
  respond.get("rne1")(makeProgram("rne1"));
  await flush();
  assert.equal(h.selected.at(-1).program.stationId, "rner4");
  assert.equal(h.rows.get("rner3").program.stationId, "rner3");
});

test("una emisora sin datos no impide mostrar los programas del resto", async () => {
  const h = harness(async (id) => { if (id === "rner3") throw new Error("offline"); return makeProgram(id); });
  h.controller.start();
  await flush();
  assert.equal(h.rows.get("rner3").status, "unavailable");
  assert.equal(h.rows.get("rner4").status, "ready");
  h.controller.select("rner3");
  assert.equal(h.selected.at(-1).status, "unavailable");
});

test("el refresco actualiza fila y reproductor utilizando la misma respuesta", async () => {
  let version = 0;
  const h = harness(async (id) => makeProgram(id, `Programa ${++version}`));
  h.controller.select("rner3");
  await flush();
  const previous = h.rows.get("rner3").program.title;
  for (const callback of [...h.timers]) { h.timers.delete(callback); callback(); }
  await flush();
  assert.notEqual(h.rows.get("rner3").program.title, previous);
  assert.deepEqual(h.selected.at(-1), h.rows.get("rner3"));
  assert.equal(h.calls.length, 6);
});

test("no muestra un programa vencido al cambiar de selección y cancela al cerrar", async () => {
  const h = harness();
  h.controller.start();
  await flush();
  h.setNow(NOW + 120000);
  h.controller.select("rner3");
  assert.equal(h.selected.at(-1).status, "loading");
  h.controller.dispose();
  assert.equal(h.timers.size, 0);
  h.controller.start();
  h.controller.select("rner4");
  assert.equal(h.calls.length, 3);
});

test("cerrar durante las consultas no actualiza ninguna fila", async () => {
  const respond = [];
  const h = harness((id) => new Promise((resolve) => respond.push(() => resolve(makeProgram(id)))));
  h.controller.start();
  h.controller.dispose();
  for (const resolve of respond) resolve();
  await flush();
  assert.ok([...h.rows.values()].every((state) => state.status === "loading"));
  assert.equal(h.timers.size, 0);
});
