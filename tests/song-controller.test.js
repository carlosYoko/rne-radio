import { test } from "node:test";
import assert from "node:assert/strict";
import { SongController } from "../build/application/song-controller.js";

const NOW = 1000000;
const song = { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: NOW, expiresAt: NOW + 60000 };
const state = { stationId: "rner3", volume: 0.8, status: "playing", error: "" };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(getCurrent = async () => song) {
  let now = NOW;
  const rendered = [], timers = new Map(), calls = [];
  const controller = new SongController({ getCurrent() { calls.push(true); return getCurrent(); } }, {
    renderSong: (value) => rendered.push(value)
  }, { after(ms, callback) { timers.set(callback, ms); return () => timers.delete(callback); } }, () => now);
  return {
    controller, rendered, timers, calls, setNow: (value) => { now = value; },
    fire(ms) { const callback = [...timers].find(([, delay]) => delay === ms)?.[0]; assert.ok(callback); timers.delete(callback); callback(); }
  };
}

test("solo consulta al reproducir Radio 3; volumen y estados repetidos no duplican", async () => {
  const h = harness();
  h.controller.update({ ...state, stationId: "rne1" });
  h.controller.update({ ...state, status: "loading" });
  assert.equal(h.calls.length, 0);
  h.controller.update(state);
  await flush();
  assert.equal(h.rendered.at(-1).title, "Tema");
  h.controller.update({ ...state, volume: 0.1 });
  assert.equal(h.calls.length, 1);
  assert.ok([...h.timers.values()].includes(15000));
});

test("canción antigua, futura, de otra emisora o consulta fallida nunca se muestran", async () => {
  for (const result of [null, { ...song, expiresAt: NOW }, { ...song, detectedAt: NOW + 1 }, { ...song, stationId: "rne1" }]) {
    const h = harness(async () => result);
    h.controller.update(state);
    await flush();
    assert.equal(h.rendered.at(-1), null);
  }
  const h = harness(async () => { throw new Error("offline"); });
  h.controller.update(state);
  await flush();
  assert.equal(h.rendered.at(-1), null);
  assert.deepEqual([...h.timers.values()], [15000]);
});

test("la canción desaparece al vencer aunque la siguiente consulta esté pendiente", async () => {
  let respond;
  let calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.resolve(song) : new Promise((resolve) => { respond = resolve; }));
  h.controller.update(state);
  await flush();
  h.setNow(NOW + 15000);
  h.fire(15000);
  h.setNow(NOW + 60000);
  h.fire(60000);
  assert.equal(h.rendered.at(-1), null);
  respond(song); // También caducó durante la petición: no reaparece.
  await flush();
  assert.equal(h.rendered.at(-1), null);
});

test("un fallo en el refresco retira también una identificación aún reciente", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) return song;
    throw new Error("offline");
  });
  h.controller.update(state);
  await flush();
  assert.equal(h.rendered.at(-1).title, "Tema");
  h.setNow(NOW + 15000);
  h.fire(15000);
  await flush();
  assert.equal(h.rendered.at(-1), null);
  assert.deepEqual([...h.timers.values()], [15000]);
});

test("volver a Radio 3 no permite que la consulta anterior sustituya a la nueva", async () => {
  const responses = [];
  const h = harness(() => new Promise((resolve) => responses.push(resolve)));
  h.controller.update(state);
  h.controller.update({ ...state, stationId: "rne1" });
  h.controller.update(state);
  responses[1]({ ...song, title: "Nuevo tema" });
  await flush();
  responses[0](song);
  await flush();
  assert.equal(h.rendered.at(-1).title, "Nuevo tema");
  h.controller.dispose();
  assert.equal(h.timers.size, 0);
});

test("recuperar visibilidad vuelve a validar por si se retrasó el timer", async () => {
  const h = harness();
  h.controller.update(state);
  await flush();
  h.setNow(NOW + 60000);
  h.controller.checkFreshness();
  assert.equal(h.rendered.at(-1), null);
});

test("parar, error o cambiar de emisora oculta y cancela consultas", async () => {
  for (const next of [{ ...state, status: "stopped" }, { ...state, status: "error" }, { ...state, stationId: "rner4" }]) {
    const h = harness();
    h.controller.update(state);
    await flush();
    h.controller.update(next);
    assert.equal(h.rendered.at(-1), null);
    assert.equal(h.timers.size, 0);
  }
});

test("buffering no borra una canción vigente ni reinicia el sondeo", async () => {
  const h = harness();
  h.controller.update(state);
  await flush();
  h.controller.update({ ...state, status: "buffering" });
  assert.equal(h.rendered.at(-1).title, "Tema");
  assert.equal(h.calls.length, 1);
  h.setNow(NOW + 60000);
  h.fire(60000);
  assert.equal(h.rendered.at(-1), null);
});

test("volver a Radio 3 recupera solo una identificación vigente, sin renovar su fecha", async () => {
  let calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.resolve(song) : new Promise(() => {}));
  h.controller.update(state);
  await flush();
  h.controller.update({ ...state, stationId: "rne1" });
  h.setNow(NOW + 30000);
  h.controller.update(state);
  assert.equal(h.rendered.at(-1).title, "Tema");
  assert.ok([...h.timers.values()].includes(30000));
  h.controller.update({ ...state, stationId: "rne1" });
  h.setNow(NOW + 60000);
  h.controller.update(state);
  assert.equal(h.rendered.at(-1), null);
});

test("las actualizaciones compartidas muestran canciones sucesivas y no renuevan caducidad", async () => {
  const h = harness();
  h.controller.update(state);
  await flush();
  h.setNow(NOW + 5000);
  const next = { ...song, title: "Otro tema", detectedAt: NOW + 5000, expiresAt: NOW + 65000 };
  h.controller.receive(next);
  assert.equal(h.rendered.at(-1).title, "Otro tema");
  h.setNow(NOW + 10000);
  h.controller.receive(next);
  assert.ok([...h.timers.values()].includes(55000));
  h.controller.receive(null);
  assert.equal(h.rendered.at(-1), null);
  h.controller.receive(next);
  assert.equal(h.rendered.at(-1).title, "Otro tema");
  h.setNow(NOW + 65000);
  h.controller.receive(next);
  assert.equal(h.rendered.at(-1), null);
});

test("un snapshot pendiente o fallido no borra una canción compartida más reciente", async () => {
  for (const fails of [false, true]) {
    let resolve, reject;
    const h = harness(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    h.controller.update(state);
    h.controller.receive(song);
    if (fails) reject(new Error("snapshot no disponible"));
    else resolve(null);
    await flush();
    assert.equal(h.rendered.at(-1).title, "Tema");
    assert.ok([...h.timers.values()].includes(15000), "El refresco debe continuar tras la carrera");
  }
});

test("una actualización compartida vacía prevalece sobre un snapshot antiguo con canción", async () => {
  let resolve;
  const h = harness(() => new Promise((yes) => { resolve = yes; }));
  h.controller.update(state);
  h.controller.receive(null);
  resolve(song);
  await flush();
  assert.equal(h.rendered.at(-1), null);
});

test("actualizaciones compartidas no muestran música en otra emisora, detenida o cerrada", async () => {
  for (const next of [{ ...state, stationId: "rne1" }, { ...state, status: "stopped" }]) {
    const h = harness();
    h.controller.update(next);
    h.controller.receive(song);
    assert.equal(h.rendered.filter(Boolean).length, 0);
  }
  const h = harness();
  h.controller.update(state);
  await flush();
  h.controller.dispose();
  h.controller.receive(song);
  assert.equal(h.rendered.at(-1), null);
  assert.equal(h.timers.size, 0);
});

test("consulta manual comparte un sondeo pendiente y deja un solo refresco programado", async () => {
  let resolve;
  const h = harness(() => new Promise((yes) => { resolve = yes; }));
  h.controller.update(state);
  const first = h.controller.refreshNow(), second = h.controller.refreshNow();
  assert.equal(h.calls.length, 1);
  resolve(song);
  assert.deepEqual(await first, song);
  assert.deepEqual(await second, song);
  assert.equal([...h.timers.values()].filter((ms) => ms === 15000).length, 1);
});

test("consulta manual adelanta el siguiente sondeo sin prolongar la identificación", async () => {
  const h = harness();
  h.controller.update(state);
  await flush();
  h.setNow(NOW + 10000);
  assert.deepEqual(await h.controller.refreshNow(), song);
  assert.equal(h.calls.length, 2);
  assert.equal([...h.timers.values()].filter((ms) => ms === 15000).length, 1);
  assert.ok([...h.timers.values()].includes(50000));
});

test("el error manual se comunica al solicitante pero el sondeo automático puede recuperarse", async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 2) throw new Error("HTTP 503"); return song; });
  h.controller.update(state);
  await flush();
  await assert.rejects(h.controller.refreshNow(), /503/);
  assert.equal(h.rendered.at(-1), null);
  h.fire(15000);
  await flush();
  assert.equal(h.rendered.at(-1).title, "Tema");
  h.controller.dispose();
  assert.equal(await h.controller.refreshNow(), null);
  assert.equal(calls, 3);
});

test("una consulta manual pendiente no mantiene visible una canción que ya venció", async () => {
  let resolve, calls = 0;
  const h = harness(() => ++calls === 1 ? Promise.resolve(song) : new Promise((yes) => { resolve = yes; }));
  h.controller.update(state);
  await flush();
  h.setNow(NOW + 10000);
  const pending = h.controller.refreshNow();
  h.setNow(NOW + 60000);
  h.fire(60000);
  assert.equal(h.rendered.at(-1), null);
  resolve(song);
  assert.equal(await pending, null);
  assert.equal(h.rendered.at(-1), null);
});

test("la consulta manual no consulta estando detenido ni revive datos tras cambiar emisora", async () => {
  let resolve;
  const h = harness(() => new Promise((yes) => { resolve = yes; }));
  assert.equal(await h.controller.refreshNow(), null);
  assert.equal(h.calls.length, 0);
  h.controller.update(state);
  const pending = h.controller.refreshNow();
  h.controller.update({ ...state, stationId: "rne1" });
  resolve(song);
  assert.equal(await pending, null);
  assert.equal(h.rendered.at(-1), null);
  assert.equal(h.timers.size, 0);
});

test("respuestas antiguas no vuelven tras cambiar emisora o cerrar", async () => {
  for (const dispose of [false, true]) {
    let respond;
    const h = harness(() => new Promise((resolve) => { respond = resolve; }));
    h.controller.update(state);
    if (dispose) h.controller.dispose();
    else h.controller.update({ ...state, stationId: "rner4" });
    respond(song);
    await flush();
    assert.equal(h.rendered.at(-1), null);
    assert.equal(h.timers.size, 0);
  }
});
