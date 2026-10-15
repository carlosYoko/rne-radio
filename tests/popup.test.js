import { test } from "node:test";
import assert from "node:assert/strict";
import { PopupController } from "../build/application/popup-controller.js";

const state = { stationId: "rne1", volume: 0.8, status: "stopped", error: "" };
function harness(execute = async () => ({ ...state })) {
  const rendered = [], busy = [], errors = [], timers = new Set();
  const controller = new PopupController({ execute }, {
    render: (value, pending) => rendered.push({ state: value, pending }),
    setBusy: (pending, ready) => busy.push({ pending, ready }),
    showError: (value) => errors.push(value)
  }, { after(ms, callback) {
    assert.equal(ms, 100);
    timers.add(callback);
    return () => timers.delete(callback);
  } });
  return { controller, rendered, busy, errors, timers };
}

test("una respuesta antigua no sustituye un evento más reciente", async () => {
  let respond;
  const h = harness(() => new Promise((resolve) => { respond = resolve; }));
  const start = h.controller.start();
  h.controller.receive({ ...state, stationId: "rner3" });
  respond(state);
  await start;
  assert.equal(h.rendered.at(-1).state.stationId, "rner3");
});

test("un cambio de volumen no desbloquea una selección pendiente", async () => {
  let resolveSelect;
  const h = harness(async (command) => {
    if (command.type === "SELECT_STATION") return new Promise((resolve) => { resolveSelect = resolve; });
    return state;
  });
  await h.controller.start();
  const select = h.controller.command({ type: "SELECT_STATION", payload: { stationId: "rner3" } });
  await h.controller.command({ type: "SET_VOLUME", payload: { volume: 0.3 } });
  assert.equal(h.busy.at(-1).pending, true);
  resolveSelect({ ...state, stationId: "rner3" });
  await select;
  assert.equal(h.busy.at(-1).pending, false);
});

test("toggle usa el estado actual y muestra fallos sin bloquear la vista", async () => {
  const commands = [];
  const h = harness(async (command) => {
    commands.push(command.type);
    if (command.type === "STOP") throw new Error("sin conexión");
    return { ...state, status: "loading" };
  });
  await h.controller.toggle();
  await h.controller.toggle();
  assert.deepEqual(commands, ["PLAY", "STOP"]);
  assert.deepEqual(h.errors, ["sin conexión"]);
  assert.equal(h.busy.at(-1).pending, false);
});

test("volumen aplica debounce y el cambio final se envía inmediatamente", async () => {
  const commands = [];
  const h = harness(async (command) => { commands.push(command); return state; });
  h.controller.setVolume(0.1);
  h.controller.setVolume(0.4);
  assert.equal(h.timers.size, 1);
  h.controller.setVolume(0.6, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.timers.size, 0);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.volume, 0.6);
  h.controller.setVolume(0.2);
  h.controller.dispose();
  assert.equal(h.timers.size, 0);
});
