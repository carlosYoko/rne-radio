import { test } from "node:test";
import assert from "node:assert/strict";
import { RuntimePlaybackSongClient } from "../build/infrastructure/chrome/playback-song-client.js";

const song = { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: 100000, expiresAt: 160000 };
test("el popup lee el estado compartido en vez de solicitar otra identificación a RTVE", async () => {
  const messages = [];
  globalThis.chrome = { runtime: { async sendMessage(message) {
    messages.push(message);
    return { metadata: { stationId: "rner3", program: null, song } };
  } } };
  try {
    const client = new RuntimePlaybackSongClient();
    assert.deepEqual(await client.getCurrent(), song);
    assert.deepEqual(await client.getCurrent(), song);
    assert.deepEqual(messages, [
      { target: "background", type: "GET_PLAYBACK_METADATA" },
      { target: "background", type: "GET_PLAYBACK_METADATA" }
    ]);
  } finally { delete globalThis.chrome; }
});

test("solo la acción explícita solicita refrescar RTVE a través del propietario offscreen", async () => {
  let response = { song };
  const messages = [];
  globalThis.chrome = { runtime: { async sendMessage(message) { messages.push(message); return response; } } };
  try {
    const client = new RuntimePlaybackSongClient();
    assert.deepEqual(await client.refresh(), song);
    assert.deepEqual(messages, [{ target: "background", type: "REFRESH_PLAYBACK_SONG" }]);
    response = { song: null };
    assert.equal(await client.refresh(), null);
    response = { error: "HTTP 503" };
    await assert.rejects(client.refresh(), /503/);
  } finally { delete globalThis.chrome; }
});

test("sin canción o con otra emisora devuelve null; respuestas inválidas fallan con seguridad", async () => {
  let response;
  globalThis.chrome = { runtime: { async sendMessage() { return response; } } };
  try {
    const client = new RuntimePlaybackSongClient();
    for (response of [{ metadata: null }, { metadata: { stationId: "rne1", program: null, song: null } }]) {
      assert.equal(await client.getCurrent(), null);
    }
    for (response of [{}, { metadata: { stationId: "rne1", program: null, song } }, { error: "offscreen no disponible" }]) {
      await assert.rejects(client.getCurrent());
    }
  } finally { delete globalThis.chrome; }
});
