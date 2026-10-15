import { test } from "node:test";
import assert from "node:assert/strict";
import { toolbarTitle, isToolbarMetadata } from "../build/domain/toolbar-metadata.js";
import { PlaybackMetadataController } from "../build/application/playback-metadata-controller.js";
import { ChromeToolbar } from "../build/infrastructure/chrome/toolbar.js";

const now = 1000000;
const song = { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: now, expiresAt: now + 5000 };
const program = { stationId: "rner3", title: "Programa", presenter: "Locutor", startTime: "20:00", endTime: "21:00", expiresAt: now + 60000 };
const metadata = { stationId: "rner3", program, song };
const state = { stationId: "rner3", status: "playing", volume: 0.8, error: "" };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("tooltip con emisora, nombre del programa, canción y artista; excluye datos caducados", () => {
  assert.equal(toolbarTitle(metadata, now), "RNE · Radio 3\nPrograma: Programa\nTema — Artista");
  assert.equal(toolbarTitle(metadata, now + 5000), "RNE · Radio 3\nPrograma: Programa");
  assert.equal(toolbarTitle(metadata, now + 60000), "RNE · Radio 3");
  assert.ok(!toolbarTitle(metadata, now - 1).includes("Tema"));
  assert.ok(isToolbarMetadata(metadata));
  assert.equal(isToolbarMetadata({ ...metadata, stationId: "rne1" }), false);
  assert.equal(isToolbarMetadata({ stationId: "rner3" }), false);
});

test("metadatos ligados al audio refrescan y caducan sin depender de popup o worker", async () => {
  let time = now, programCalls = 0, songCalls = 0;
  const timers = new Map(), rendered = [];
  const controller = new PlaybackMetadataController({ async getCurrent() { programCalls++; return program; } },
    { async getCurrent() { songCalls++; return song; } },
    { after(ms, fn) { timers.set(fn, ms); return () => timers.delete(fn); } },
    (value) => rendered.push(value), () => time);
  controller.update(state);
  await flush();
  assert.deepEqual(rendered.at(-1), metadata);
  controller.update({ ...state, status: "buffering" });
  assert.deepEqual(rendered.at(-1), metadata);
  assert.equal(programCalls, 1);
  assert.equal(songCalls, 1);
  time += 5000;
  const expiry = [...timers].find(([, ms]) => ms === 5000)[0];
  timers.delete(expiry); expiry();
  assert.equal(rendered.at(-1).song, null);
  assert.equal(rendered.at(-1).program.title, "Programa");
  controller.update({ ...state, status: "stopped" });
  assert.deepEqual(rendered.at(-1), { stationId: "rner3", program: null, song: null });
  assert.equal(timers.size, 0);
});

test("reabrir clientes lee el snapshot sin otra consulta ni prolongar la canción", async () => {
  let time = now, songCalls = 0;
  const controller = new PlaybackMetadataController({ async getCurrent() { return program; } },
    { async getCurrent() { songCalls++; return song; } },
    { after() { return () => {}; } }, () => {}, () => time);
  assert.equal(controller.snapshot(), null);
  controller.update(state);
  await flush();
  for (let i = 0; i < 4; i++) {
    time += 1000;
    controller.update(state); // GET_STATE/GET_METADATA al abrir otro popup.
    assert.deepEqual(controller.snapshot().song, song);
    assert.equal(songCalls, 1);
  }
  time = now + 5000; // Aunque el timer no se haya ejecutado, el snapshot valida frescura.
  assert.equal(controller.snapshot().song, null);
  assert.equal(controller.snapshot().program.title, "Programa");
  time = now + 60000;
  assert.equal(controller.snapshot().program, null);
  controller.dispose();
  assert.equal(controller.snapshot(), null);
});

test("cambio de emisora ignora metadatos pendientes; detener cancela timers", async () => {
  const responses = [], rendered = [];
  const timers = new Map();
  const controller = new PlaybackMetadataController({ getCurrent: () => new Promise((resolve) => responses.push(resolve)) },
    { async getCurrent() { return song; } },
    { after(ms, fn) { timers.set(fn, ms); return () => timers.delete(fn); } },
    (value) => rendered.push(value), () => now);
  controller.update(state);
  await flush();
  controller.update({ ...state, stationId: "rne1" });
  responses[0](program);
  responses[1]({ ...program, stationId: "rne1", title: "Programa RNE" });
  await flush();
  assert.equal(rendered.at(-1).stationId, "rne1");
  assert.equal(rendered.at(-1).program.title, "Programa RNE");
  assert.equal(rendered.at(-1).song, null);
  controller.update({ ...state, stationId: "rne1", status: "stopped" });
  assert.equal(timers.size, 0);
});

test("adaptador ignora respuestas de otra emisora y serializa el tooltip con los iconos", async () => {
  const titles = [];
  globalThis.chrome = { runtime: { getURL: (path) => path }, action: {
    setTitle: async ({ title }) => { titles.push(title); }, setIcon: async () => {}, setBadgeText: async () => {}
  } };
  try {
    const toolbar = new ChromeToolbar();
    const freshSong = { ...song, detectedAt: Date.now(), expiresAt: Date.now() + 5000 };
    const fresh = { ...metadata, program: { ...program, expiresAt: Date.now() + 60000 }, song: freshSong };
    await toolbar.showStation("rner3");
    await toolbar.showMetadata(fresh);
    assert.ok(titles.at(-1).includes("Tema — Artista"));
    await toolbar.showStation("rner3");
    assert.ok(titles.at(-1).includes("Tema — Artista"));
    await Promise.all([toolbar.showStation("rne1"), toolbar.showMetadata(fresh)]);
    assert.equal(titles.at(-1), "RNE · Radio Nacional");
  } finally { delete globalThis.chrome; }
});
