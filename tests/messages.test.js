import { test } from "node:test";
import assert from "node:assert/strict";
import { isBackgroundMessage, isPlayerMessage, isPopupMessage, readStateResponse, readProgramResponse, readSongResponse, readMetadataResponse } from "../build/infrastructure/chrome/messages.js";

const state = { stationId: "rner3", volume: 0.5, status: "playing", error: "" };

test("acepta mensajes discriminados válidos", () => {
  assert.ok(isBackgroundMessage({ target: "background", type: "COMMAND", command: { type: "PLAY" } }));
  assert.ok(isBackgroundMessage({ target: "background", type: "GET_PROGRAM", stationId: "rner3" }));
  assert.ok(isBackgroundMessage({ target: "background", type: "SAVE_SETTINGS", settings: { stationId: "rne1", volume: 0 } }));
  assert.ok(isPlayerMessage({ target: "player", command: { type: "SET_VOLUME", payload: { volume: 0.2 } } }));
  assert.ok(isPopupMessage({ target: "popup", type: "STATE_CHANGED", state }));
  assert.deepEqual(readStateResponse({ state }), state);
});

test("rechaza estructuras malformadas, emisoras inválidas y volúmenes no finitos", () => {
  for (const command of [null, {}, { type: "UNKNOWN" },
    { type: "SELECT_STATION", payload: { stationId: "bad" } },
    { type: "SET_VOLUME", payload: { volume: NaN } },
    { type: "SET_VOLUME", payload: { volume: "0.5" } }]) {
    assert.equal(isBackgroundMessage({ target: "background", type: "COMMAND", command }), false);
  }
  assert.equal(isPopupMessage({ target: "popup", type: "STATE_CHANGED", state: { ...state, status: "invalid" } }), false);
  assert.equal(isBackgroundMessage({ target: "background", type: "SAVE_SETTINGS", settings: { stationId: "rne1", volume: 2 } }), false);
  assert.throws(() => readStateResponse({ error: "fallo" }), /fallo/);
  assert.throws(() => readStateResponse(undefined));
  assert.equal(isBackgroundMessage({ target: "background", type: "GET_PROGRAM", stationId: "invalid" }), false);
});

test("valida mensajes y respuestas musicales, sin aceptar otras emisoras o caducidad excesiva", () => {
  const song = { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: 100000, expiresAt: 160000 };
  assert.ok(isBackgroundMessage({ target: "background", type: "GET_SONG", stationId: "rner3" }));
  assert.equal(isBackgroundMessage({ target: "background", type: "GET_SONG", stationId: "rne1" }), false);
  assert.equal(readSongResponse({ song: null }), null);
  assert.deepEqual(readSongResponse({ song }), song);
  for (const value of [undefined, {}, { state }, { song: { ...song, stationId: "rne1" } },
    { song: { ...song, expiresAt: 160001 } }, { song: { ...song, artists: [] } }, { song: { ...song, detectedAt: NaN } }]) {
    assert.throws(() => readSongResponse(value));
  }
  assert.throws(() => readSongResponse({ error: "offline" }), /offline/);
});

test("valida los metadatos del tooltip y rechaza canciones de otra emisora", () => {
  const metadata = { stationId: "rner3", program: null, song: null };
  assert.ok(isBackgroundMessage({ target: "background", type: "UPDATE_METADATA", metadata }));
  assert.equal(isBackgroundMessage({ target: "background", type: "UPDATE_METADATA", metadata: {} }), false);
  assert.equal(isBackgroundMessage({ target: "background", type: "UPDATE_METADATA", metadata: {
    ...metadata, stationId: "rne1", song: { stationId: "rner3", title: "Tema", artists: ["Artista"], detectedAt: 1, expiresAt: 60000 }
  } }), false);
});

test("valida snapshots y eventos compartidos, sin confundirlos con comandos", () => {
  const metadata = { stationId: "rner3", program: null, song: null };
  assert.ok(isBackgroundMessage({ target: "background", type: "GET_PLAYBACK_METADATA" }));
  assert.ok(isBackgroundMessage({ target: "background", type: "REFRESH_PLAYBACK_SONG" }));
  assert.ok(isPlayerMessage({ target: "player", type: "REFRESH_SONG" }));
  assert.equal(isPlayerMessage({ target: "player", type: "REFRESH_SONG", command: { type: "PLAY" } }), false);
  assert.ok(isPlayerMessage({ target: "player", type: "GET_METADATA" }));
  assert.equal(isPlayerMessage({ target: "player", type: "GET_METADATA", command: { type: "PLAY" } }), false);
  assert.equal(isPlayerMessage({ target: "player", type: "UNKNOWN" }), false);
  assert.ok(isPopupMessage({ target: "popup", type: "METADATA_CHANGED", metadata }));
  assert.equal(isPopupMessage({ target: "popup", type: "METADATA_CHANGED", metadata: {} }), false);
  assert.equal(isPopupMessage({ target: "popup", type: "METADATA_CHANGED", metadata: { ...metadata, song: { title: "bad" } } }), false);
  assert.deepEqual(readMetadataResponse({ metadata }), metadata);
  assert.equal(readMetadataResponse({ metadata: null }), null);
  for (const value of [undefined, {}, { state }, { metadata: {} }, { metadata: { ...metadata, stationId: "invalid" } }]) {
    assert.throws(() => readMetadataResponse(value));
  }
  assert.throws(() => readMetadataResponse({ error: "no disponible" }), /no disponible/);
});

test("valida respuestas de programación sin confundirlas con estado del audio", () => {
  const program = { stationId: "rner3", title: "Programa", presenter: "", startTime: "22:00", endTime: "23:00", expiresAt: 123456789 };
  assert.deepEqual(readProgramResponse({ program }), program);
  assert.equal(readProgramResponse({ program: null }), null);
  for (const value of [undefined, {}, { state }, { program: { ...program, endTime: "invalid" } },
    { program: { ...program, expiresAt: NaN } }, { program: { ...program, title: " " } }]) {
    assert.throws(() => readProgramResponse(value));
  }
  assert.throws(() => readProgramResponse({ error: "offline" }), /offline/);
});
