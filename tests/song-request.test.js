import { test } from "node:test";
import assert from "node:assert/strict";
import { SongRequestController } from "../build/application/song-request-controller.js";

const NOW = 1000000;
const song = { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: NOW, expiresAt: NOW + 60000 };
const state = { stationId: "rner3", volume: 0.8, status: "playing", error: "" };
function harness(refresh = async () => song) {
  const rendered = [], calls = [];
  const controller = new SongRequestController({ refresh() { calls.push(true); return refresh(); } },
    { renderSongRequest: (value) => rendered.push(value) }, () => NOW);
  return { controller, rendered, calls };
}

test("el botón solo está disponible para Radio 3 reproduciendo o recuperando señal", async () => {
  const h = harness();
  for (const next of [{ ...state, stationId: "rne1" }, { ...state, status: "stopped" }, { ...state, status: "loading" }, { ...state, status: "error" }]) {
    h.controller.update(next);
    assert.equal(h.rendered.at(-1).visible, next.stationId === "rner3");
    assert.equal(h.rendered.at(-1).enabled, false);
    await h.controller.request();
  }
  assert.equal(h.calls.length, 0);
  h.controller.update({ ...state, status: "buffering" });
  assert.equal(h.rendered.at(-1).enabled, true);
  await h.controller.request();
  assert.equal(h.calls.length, 1);
});

test("consulta explícita con estado ocupado; no duplica clics ni se altera al cambiar volumen", async () => {
  let resolve;
  const h = harness(() => new Promise((yes) => { resolve = yes; }));
  h.controller.update(state);
  const first = h.controller.request();
  assert.deepEqual(h.rendered.at(-1), { visible: true, enabled: false, busy: true, message: "Consultando RTVE…" });
  await h.controller.request();
  h.controller.update({ ...state, volume: 0.3, status: "buffering" });
  assert.equal(h.rendered.at(-1).busy, true);
  assert.equal(h.calls.length, 1);
  resolve(song);
  await first;
  assert.deepEqual(h.rendered.at(-1), { visible: true, enabled: true, busy: false, message: "" });
});

test("no presenta como éxito datos vacíos, caducados, futuros o de otra emisora", async () => {
  for (const result of [null, { ...song, expiresAt: NOW }, { ...song, detectedAt: NOW + 1 }, { ...song, stationId: "rne1" }]) {
    const h = harness(async () => result);
    h.controller.update(state);
    await h.controller.request();
    assert.equal(h.rendered.at(-1).message, "RTVE no ofrece una identificación reciente.");
    assert.equal(h.rendered.at(-1).enabled, true);
  }
});

test("el error no bloquea reintentos y una actualización automática retira el aviso antiguo", async () => {
  let fails = true;
  const h = harness(async () => { if (fails) throw new Error("HTTP 503"); return song; });
  h.controller.update(state);
  await h.controller.request();
  assert.match(h.rendered.at(-1).message, /No se ha podido consultar RTVE/);
  assert.equal(h.rendered.at(-1).enabled, true);
  h.controller.receive(null);
  assert.match(h.rendered.at(-1).message, /No se ha podido/);
  h.controller.receive(song);
  assert.equal(h.rendered.at(-1).message, "");
  fails = false;
  await h.controller.request();
  assert.equal(h.calls.length, 2);
  assert.equal(h.rendered.at(-1).message, "");
});

test("parar, cambiar emisora o cerrar descarta resultados tardíos de la consulta", async () => {
  for (const action of ["stop", "station", "dispose"]) {
    let resolve;
    const h = harness(() => new Promise((yes) => { resolve = yes; }));
    h.controller.update(state);
    const pending = h.controller.request();
    if (action === "dispose") h.controller.dispose();
    else h.controller.update(action === "stop" ? { ...state, status: "stopped" } : { ...state, stationId: "rner4" });
    const before = h.rendered.length;
    resolve(null);
    await pending;
    assert.equal(h.rendered.length, before);
    if (action !== "dispose") assert.equal(h.rendered.at(-1).enabled, false);
  }
});
