import { test } from "node:test";
import assert from "node:assert/strict";
import { RadioPlayer } from "../build/application/radio-player.js";
import { STATIONS, streamUrl } from "../build/domain/stations.js";

function harness(saved = {}, loadFails = false) {
  const stored = { ...saved };
  const listeners = new Map();
  const timers = new Set();
  const messages = [];
  let failPlay = false;
  const audio = {
    paused: true, src: "", volume: 0,
    play(url) { this.src = url; this.paused = false; return failPlay ? Promise.reject(new Error("network")) : Promise.resolve(); },
    release() { this.paused = true; this.src = ""; },
    setVolume(volume) { this.volume = volume; },
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); }
  };
  const clock = { after(ms, callback) {
    assert.ok(ms === 25000);
    timers.add(callback);
    return () => timers.delete(callback);
  } };
  const settings = {
    async load() { if (loadFails) throw new Error("storage"); return stored; },
    async save(value) { Object.assign(stored, value); }
  };
  const player = new RadioPlayer(audio, settings, clock);
  player.subscribe((state) => messages.push(state));
  return { player, audio, stored, timers, messages, listeners, failPlay: () => { failPlay = true; } };
}

test("seis emisoras y direcciones estables válidas", () => {
  assert.equal(STATIONS.length, 6);
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, 6);
  for (const station of STATIONS) assert.match(streamUrl(station.id), /^https:\/\/dispatcher\.rndfnk\.com\/crtve\/.+\/main\/mp3\/high$/);
  assert.throws(() => streamUrl("unknown"));
});

test("restaura ajustes sin iniciar sonido; cada snapshot es una copia", async () => {
  const h = harness({ stationId: "rner3", volume: 0.3 });
  const state = await h.player.execute({ type: "GET_STATE" });
  assert.equal(state.stationId, "rner3");
  assert.equal(state.volume, 0.3);
  assert.equal(state.status, "stopped");
  assert.equal(h.audio.paused, true);
  state.volume = 1;
  assert.equal(h.player.snapshot().volume, 0.3);
});

test("valores corruptos o almacenamiento no disponible usan ajustes seguros", async () => {
  for (const h of [harness({ stationId: "bad", volume: "bad" }), harness({}, true)]) {
    assert.deepEqual(await h.player.execute({ type: "GET_STATE" }), {
      stationId: "rne1", volume: 0.8, status: "stopped", error: ""
    });
  }
});

test("seleccionar en reposo no reproduce; seleccionar en directo cambia la señal", async () => {
  const h = harness();
  await h.player.execute({ type: "SELECT_STATION", payload: { stationId: "rner4" } });
  assert.equal(h.audio.paused, true);
  assert.equal((await h.player.execute({ type: "PLAY" })).status, "loading");
  assert.equal(h.audio.src, streamUrl("rner4"));
  h.audio.emit("playing");
  const state = await h.player.execute({ type: "SELECT_STATION", payload: { stationId: "rner3" } });
  assert.equal(state.stationId, "rner3");
  assert.equal(h.audio.src, streamUrl("rner3"));
  await h.player.flushSettings();
  assert.equal(h.stored.stationId, "rner3");
});

test("reseleccionar la emisora actual no reinicia la señal ni cambia playing a loading", async () => {
  const h = harness({ stationId: "rner3" });
  let plays = 0, releases = 0;
  const play = h.audio.play.bind(h.audio), release = h.audio.release.bind(h.audio);
  h.audio.play = (url) => { plays++; return play(url); };
  h.audio.release = () => { releases++; release(); };
  await h.player.execute({ type: "PLAY" });
  h.audio.emit("playing");
  const count = h.messages.length;
  const state = await h.player.execute({ type: "SELECT_STATION", payload: { stationId: "rner3" } });
  assert.equal(state.status, "playing");
  assert.equal(plays, 1);
  assert.equal(releases, 1);
  assert.equal(h.messages.length, count);
});

test("detener libera la señal y cancela el timeout", async () => {
  const h = harness();
  await h.player.execute({ type: "PLAY" });
  const state = await h.player.execute({ type: "STOP" });
  assert.equal(state.status, "stopped");
  assert.equal(h.audio.src, "");
  assert.equal(h.timers.size, 0);
  assert.equal(h.audio.paused, true);
});

test("valida entradas y limita el volumen", async () => {
  const h = harness();
  await assert.rejects(h.player.execute({ type: "SELECT_STATION", payload: { stationId: "invalid" } }));
  await assert.rejects(h.player.execute({ type: "SET_VOLUME", payload: { volume: NaN } }));
  assert.equal((await h.player.execute({ type: "SET_VOLUME", payload: { volume: 3 } })).volume, 1);
  assert.equal((await h.player.execute({ type: "SET_VOLUME", payload: { volume: -1 } })).volume, 0);
  await h.player.flushSettings();
  assert.equal(h.stored.volume, 0);
});

test("un fallo de reproducción se comunica", async () => {
  const h = harness();
  h.failPlay();
  await h.player.execute({ type: "PLAY" });
  await Promise.resolve();
  assert.equal(h.player.snapshot().status, "error");
  assert.ok(h.player.snapshot().error);
});

test("timeout e interrupciones permiten reintentar", async () => {
  const h = harness();
  await h.player.execute({ type: "PLAY" });
  for (const callback of [...h.timers]) callback();
  assert.equal(h.player.snapshot().status, "error");
  await h.player.execute({ type: "PLAY" });
  h.audio.emit("playing");
  assert.equal(h.player.snapshot().status, "playing");
  h.audio.emit("waiting");
  assert.equal(h.player.snapshot().status, "buffering");
  h.audio.emit("ended");
  assert.equal(h.player.snapshot().status, "error");
});

test("un rechazo de la señal anterior no interrumpe la nueva emisora", async () => {
  const h = harness();
  let rejectOld;
  h.audio.play = function(url) {
    this.src = url;
    if (!rejectOld) return new Promise((_, reject) => { rejectOld = reject; });
    return Promise.resolve();
  };
  await h.player.execute({ type: "PLAY" });
  await h.player.execute({ type: "SELECT_STATION", payload: { stationId: "rner3" } });
  rejectOld(new Error("old stream"));
  await Promise.resolve();
  h.audio.emit("playing");
  assert.equal(h.player.snapshot().status, "playing");
  assert.equal(h.player.snapshot().stationId, "rner3");
});

test("persistencia ordenada y limpieza de observadores y temporizadores", async () => {
  const h = harness();
  await Promise.all([0.1, 0.7, 0.4].map((volume) => h.player.execute({ type: "SET_VOLUME", payload: { volume } })));
  await h.player.flushSettings();
  assert.equal(h.stored.volume, 0.4);
  await h.player.execute({ type: "PLAY" });
  h.player.dispose();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});
