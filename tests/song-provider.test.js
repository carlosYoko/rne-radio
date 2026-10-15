import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurrentSong, RtveSongProvider } from "../build/infrastructure/rtve/song-provider.js";
import { SONG_MAX_AGE_MS } from "../build/domain/song.js";

const DETECTED = Date.parse("2026-10-15T20:26:25Z");
function fixture(timestamp = "2026-10-15 20:26:25", changes = {}) {
  return {
    status: { code: 0 }, metadata: { type: "realtime", timestamp_utc: timestamp, music: [
      { URLimagen: "https://example.test/cover.jpg" },
      { title: "Cuervos", artists: [{ name: "Oscar Avendaño & Reposado" }], duration_ms: 254000, play_offset_ms: 152920, ...changes }
    ] }
  };
}

test("extrae título y artistas de metadatos recientes, ignorando entradas de portada", () => {
  assert.deepEqual(parseCurrentSong(fixture(), DETECTED + 10000), {
    stationId: "rner3", title: "Cuervos", artists: ["Oscar Avendaño & Reposado"],
    detectedAt: DETECTED, expiresAt: DETECTED + SONG_MAX_AGE_MS
  });
});

test("no muestra identificaciones de 60 segundos o más ni fechas futuras", () => {
  assert.ok(parseCurrentSong(fixture(), DETECTED + SONG_MAX_AGE_MS - 1));
  assert.equal(parseCurrentSong(fixture(), DETECTED + SONG_MAX_AGE_MS), null);
  assert.equal(parseCurrentSong(fixture(), DETECTED + 10 * 60000), null);
  assert.equal(parseCurrentSong(fixture(), DETECTED - 1), null);
});

test("rechaza fechas ausentes, sin UTC explícita en el formato esperado o imposibles", () => {
  for (const timestamp of [null, "", "invalid", "2026-02-30 12:00:00", "2026-10-15 24:00:00", "2026-10-15T20:26:25+02:00"]) {
    assert.equal(parseCurrentSong(fixture(timestamp), DETECTED), null);
  }
});

test("la duración restante puede ocultar la canción antes de los 60 segundos", () => {
  const data = fixture(undefined, { duration_ms: 200000, play_offset_ms: 195000 });
  assert.equal(parseCurrentSong(data, DETECTED + 1000).expiresAt, DETECTED + 5000);
  assert.equal(parseCurrentSong(data, DETECTED + 5000), null);
});

test("sin duración usa la fecha; duración o posición inválidas no se aceptan", () => {
  const noDuration = fixture(undefined, { duration_ms: undefined, play_offset_ms: undefined });
  assert.equal(parseCurrentSong(noDuration, DETECTED).expiresAt, DETECTED + 60000);
  for (const changes of [{ duration_ms: -1 }, { play_offset_ms: -1 }, { play_offset_ms: 254000 },
    { duration_ms: NaN }, { play_offset_ms: undefined }]) {
    assert.equal(parseCurrentSong(fixture(undefined, changes), DETECTED), null);
  }
});

test("rechaza datos vacíos o de error; exige canción y artista", () => {
  for (const data of [null, {}, { status: { code: 1 } }, fixture(undefined, { title: " " }),
    fixture(undefined, { artists: [] }), fixture(undefined, { artists: [{ name: " " }] })]) {
    assert.equal(parseCurrentSong(data, DETECTED), null);
  }
});

test("el proveedor no renueva timestamps antiguos por descargar de nuevo", async () => {
  let calls = 0;
  const provider = new RtveSongProvider(async function (url, options) {
    assert.equal(this, globalThis);
    assert.equal(url, "https://nowplaying.rtve.es/radio3.json");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    calls++;
    return new Response(JSON.stringify(fixture()), { headers: { Date: new Date(DETECTED + 600000).toUTCString() } });
  }, () => DETECTED + 600000);
  assert.equal(await provider.getCurrent(), null);
  assert.equal(await provider.getCurrent(), null);
  assert.equal(calls, 2);
});

test("single-flight y recuperación de errores HTTP o JSON", async () => {
  let calls = 0;
  const provider = new RtveSongProvider(async () => {
    calls++;
    await Promise.resolve();
    if (calls === 1) return new Response("error", { status: 503 });
    if (calls === 2) return new Response("not json");
    return new Response(JSON.stringify(fixture()));
  }, () => DETECTED);
  await assert.rejects(provider.getCurrent(), /503/);
  await assert.rejects(provider.getCurrent());
  const [first, second] = await Promise.all([provider.getCurrent(), provider.getCurrent()]);
  assert.equal(calls, 3);
  assert.equal(first.title, second.title);
});
