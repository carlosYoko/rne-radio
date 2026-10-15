import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgramController } from "../build/application/program-controller.js";

const NOW = 1000000;
const program = { stationId: "rner3", title: "Programa", presenter: "Presentador", startTime: "22:00", endTime: "23:00", expiresAt: NOW + 120000 };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(getCurrent = async () => program) {
  let now = NOW;
  const rendered = [], timers = new Map(), calls = [];
  const controller = new ProgramController({ getCurrent: (id) => { calls.push(id); return getCurrent(id); } }, {
    renderProgram: (state) => rendered.push(state)
  }, { after(ms, callback) { timers.set(callback, ms); return () => timers.delete(callback); } }, () => now);
  return {
    controller, rendered, timers, calls,
    advance(ms) { now += ms; },
    fire() { const callback = timers.keys().next().value; timers.delete(callback); callback(); }
  };
}

test("carga al seleccionar y refresca cada minuto; mismo estado no repite consultas", async () => {
  const h = harness();
  h.controller.select("rner3");
  assert.equal(h.rendered.at(-1).status, "loading");
  await flush();
  assert.equal(h.rendered.at(-1).program.title, "Programa");
  assert.deepEqual([...h.timers.values()], [60000]);
  h.controller.select("rner3");
  assert.equal(h.calls.length, 1);
  h.advance(60000);
  h.fire();
  await flush();
  assert.equal(h.calls.length, 2);
});

test("cambiar emisora limpia datos previos e ignora respuestas tardías", async () => {
  const responses = new Map();
  const h = harness((id) => new Promise((resolve) => responses.set(id, resolve)));
  h.controller.select("rner3");
  h.controller.select("rner4");
  responses.get("rner4")({ ...program, stationId: "rner4", title: "Nou programa" });
  await flush();
  responses.get("rner3")(program);
  await flush();
  assert.equal(h.rendered.at(-1).program.title, "Nou programa");
  assert.equal(h.timers.size, 1);
});

test("fallos o falta de datos muestran fallback y permiten refrescar", async () => {
  let attempt = 0;
  const h = harness(async () => { if (++attempt === 1) throw new Error("offline"); return program; });
  h.controller.select("rner3");
  await flush();
  assert.equal(h.rendered.at(-1).status, "unavailable");
  h.fire();
  await flush();
  assert.equal(h.rendered.at(-1).status, "ready");
  for (const value of [null, { ...program, stationId: "rne1" }, { ...program, expiresAt: NOW }]) {
    const invalid = harness(async () => value);
    invalid.controller.select("rner3");
    await flush();
    assert.equal(invalid.rendered.at(-1).status, "unavailable");
  }
});

test("el programa caducado se oculta antes de consultar el siguiente", async () => {
  let respond;
  let calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.resolve({ ...program, expiresAt: NOW + 10000 }) : new Promise((resolve) => { respond = resolve; }));
  h.controller.select("rner3");
  await flush();
  assert.deepEqual([...h.timers.values()], [10000]);
  h.advance(10000);
  h.fire();
  assert.equal(h.rendered.at(-1).status, "loading");
  respond({ ...program, title: "Siguiente programa" });
  await flush();
  assert.equal(h.rendered.at(-1).program.title, "Siguiente programa");
});

test("cerrar cancela temporizadores e ignora consultas pendientes", async () => {
  let respond;
  const h = harness(() => new Promise((resolve) => { respond = resolve; }));
  h.controller.select("rner3");
  h.controller.dispose();
  respond(program);
  await flush();
  assert.equal(h.rendered.length, 1);
  assert.equal(h.timers.size, 0);
  h.controller.select("rner4");
  assert.equal(h.calls.length, 1);
  const ready = harness();
  ready.controller.select("rner3");
  await flush();
  ready.controller.dispose();
  assert.equal(ready.timers.size, 0);
});
