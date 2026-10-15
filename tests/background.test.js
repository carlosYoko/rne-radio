import { test } from "node:test";
import assert from "node:assert/strict";
import { BackgroundService } from "../build/application/background-service.js";
import { OffscreenPlayerHost } from "../build/infrastructure/chrome/player-client.js";
import { ChromeToolbar } from "../build/infrastructure/chrome/toolbar.js";
import { STATIONS, toolbarIconPaths } from "../build/domain/stations.js";

function harness() {
  const stored = { stationId: "rner4", volume: 0.5 };
  const icons = [], commands = [];
  const service = new BackgroundService({
    load: async () => ({ ...stored }), save: async (settings) => { Object.assign(stored, settings); }
  }, {
    ensure: async () => {},
    execute: async (command) => {
      commands.push(command);
      return { ...stored, stationId: command.payload?.stationId ?? stored.stationId, status: "stopped", error: "" };
    }
  }, {
    showStation: async (id) => { icons.push(id); }
  });
  return { service, stored, icons, commands };
}

test("restaura el logo al iniciar sin reproducir", async () => {
  const h = harness();
  await h.service.initialize();
  assert.deepEqual(h.icons, ["rner4"]);
  assert.equal(h.commands.length, 0);
});

test("seleccionar cualquier emisora detenida cambia el icono", async () => {
  const h = harness();
  for (const station of STATIONS) {
    await h.service.execute({ type: "SELECT_STATION", payload: { stationId: station.id } });
    assert.equal(h.icons.at(-1), station.id);
  }
});

test("los eventos actualizan el logo; escrituras antiguas no lo cambian", async () => {
  const h = harness();
  await h.service.stateChanged({ stationId: "rner3", volume: 0.8, status: "playing", error: "" });
  await h.service.saveSettings({ stationId: "rne1", volume: 0.3 });
  assert.equal(h.icons.at(-1), "rner3");
  assert.equal((await h.service.loadSettings()).volume, 0.3);
});

test("la restauración lenta no sobrescribe una selección nueva", async () => {
  let resolveLoad;
  const icons = [];
  const service = new BackgroundService({
    load: () => new Promise((resolve) => { resolveLoad = resolve; }), save: async () => {}
  }, {}, { showStation: async (id) => { icons.push(id); } });
  const restore = service.restoreIcon();
  await service.stateChanged({ stationId: "rner3", volume: 0.8, status: "stopped", error: "" });
  resolveLoad({ stationId: "rne1", volume: 0.8 });
  await restore;
  assert.deepEqual(icons, ["rner3"]);
});

test("una respuesta antigua no sobrescribe el logo de un evento reciente", async () => {
  let respond;
  const icons = [];
  const service = new BackgroundService({}, {
    execute: () => new Promise((resolve) => { respond = resolve; })
  }, { showStation: async (id) => { icons.push(id); } });
  const request = service.execute({ type: "GET_STATE" });
  await service.stateChanged({ stationId: "rner3", volume: 0.8, status: "stopped", error: "" });
  respond({ stationId: "rne1", volume: 0.8, status: "stopped", error: "" });
  await request;
  assert.deepEqual(icons, ["rner3"]);
});

test("un fallo cosmético del icono no convierte un comando válido en un error", async () => {
  const state = { stationId: "rne1", volume: 0.8, status: "stopped", error: "" };
  const service = new BackgroundService({}, { execute: async () => state }, {
    showStation: async () => { throw new Error("icon"); }
  });
  assert.deepEqual(await service.execute({ type: "GET_STATE" }), state);
  await assert.doesNotReject(service.stateChanged(state));
});

test("el adaptador offscreen crea un solo documento para peticiones simultáneas", async () => {
  let creations = 0;
  const forwarded = [];
  globalThis.chrome = {
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => {
        forwarded.push(message);
        return { state: { stationId: "rne1", volume: 0.8, status: "stopped", error: "" } };
      }
    },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
      createDocument: async () => { creations++; await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
  };
  try {
    const host = new OffscreenPlayerHost();
    await Promise.all([host.execute({ type: "GET_STATE" }), host.execute({ type: "PLAY" })]);
    assert.equal(creations, 1);
    assert.equal(forwarded.length, 2);
    assert.equal(forwarded[0].target, "player");
  } finally { delete globalThis.chrome; }
});

test("el adaptador de barra serializa iconos y evita actualizar el mismo repetidamente", async () => {
  const icons = [], titles = [], badges = [];
  globalThis.chrome = {
    runtime: { getURL: (file) => `chrome-extension://test/${file}` },
    action: {
      setIcon: async ({ path }) => { await new Promise((resolve) => setTimeout(resolve, 2)); icons.push(path); },
      setTitle: async ({ title }) => { titles.push(title); },
      setBadgeText: async ({ text }) => { badges.push(text); }
    }
  };
  try {
    const toolbar = new ChromeToolbar();
    await Promise.all([toolbar.showStation("rner3"), toolbar.showStation("rner4"), toolbar.showStation("rner4")]);
    assert.equal(icons.length, 2);
    const expected = Object.fromEntries(Object.entries(toolbarIconPaths("rner4"))
      .map(([size, path]) => [size, `chrome-extension://test/${path}`]));
    assert.deepEqual(icons.at(-1), expected);
    assert.equal(titles.at(-1), "RNE · Ràdio 4");
    assert.deepEqual(badges, ["", "", ""]);
  } finally { delete globalThis.chrome; }
});
