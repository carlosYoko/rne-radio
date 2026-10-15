// Prueba opcional sobre una extensión real en Chromium, con perfil temporal y audio silenciado.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATIONS } from "../build/domain/stations.js";

const candidates = [process.env.CHROME_PATH,
  ...(process.platform === "win32" ? [
    `${process.env.PROGRAMFILES}/BraveSoftware/Brave-Browser/Application/brave.exe`
  ] : ["/usr/bin/chromium", "/usr/bin/chromium-browser"])
].filter(Boolean);
let browser;
for (const candidate of candidates) {
  try { await access(candidate); browser = candidate; break; } catch { /* siguiente */ }
}
if (!browser) throw new Error("Define CHROME_PATH con Brave o Chromium que admita --load-extension. Chrome comercial reciente puede ignorar esa opción.");
const livePrograms = process.argv.includes("--live-programs");
const channels = { rne1: "R1", rnerc: "R2", rner3: "R3", rner4: "R4", rne5: "R5", rneree: "R6" };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn) {
  let error;
  for (let i = 0; i < 80; i++) {
    try { const value = await fn(); if (value) return value; } catch (caught) { error = caught; }
    await delay(100);
  }
  throw error ?? new Error("Tiempo de espera agotado.");
}
class DevTools {
  sequence = 0;
  pending = new Map();
  async connect(url) {
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    return this;
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  close() { this.socket?.close(); }
}
const profile = await mkdtemp(join(tmpdir(), "rne-smoke-"));
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const processHandle = spawn(browser, [
  "--headless=new", "--disable-gpu", "--mute-audio", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0",
  `--disable-extensions-except=${root}`, `--load-extension=${root}`, "about:blank"
], { stdio: "ignore" });
let devtools;
let workerTools;
let offscreenTools;
try {
  const port = await waitFor(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
  const endpoint = `http://127.0.0.1:${port}`;
  const targets = async () => (await fetch(`${endpoint}/json/list`)).json();
  const worker = await waitFor(async () => (await targets()).find((target) => target.type === "service_worker" && target.url.includes("/build/entries/background.js")));
  workerTools = await new DevTools().connect(worker.webSocketDebuggerUrl);
  await waitFor(() => workerTools.evaluate("typeof chrome !== 'undefined' && !!chrome.action?.setIcon"));
  // Verificar el resultado real de setIcon en el worker, no solo su tooltip.
  await workerTools.evaluate(`(() => {
    globalThis.__iconCalls = [];
    const original = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = async (details) => {
      const call = { path: details.path, ok: false };
      globalThis.__iconCalls.push(call);
      try { await original(details); call.ok = true; }
      catch (error) { call.error = error.message; throw error; }
    };
  })()`);
  if (!livePrograms) {
    // Fixtures de programación: el smoke habitual no depende de la parrilla remota.
    await workerTools.evaluate(`(() => {
      const original = fetch.bind(globalThis);
      globalThis.__programFailure = 'R5';
      globalThis.__songMode = 'fresh';
      globalThis.__songCalls = 0;
      globalThis.__songTitle = 'Canción de prueba';
      globalThis.__songRemaining = 30000;
      globalThis.__songDelay = 0;
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(String(url));
        if (parsed.hostname === 'nowplaying.rtve.es') {
          globalThis.__songCalls++;
          if (globalThis.__songDelay) await new Promise(resolve => setTimeout(resolve, globalThis.__songDelay));
          if (globalThis.__songMode === 'error') return new Response('unavailable', {status:503});
          const offset = globalThis.__songMode === 'old' ? -600000 : globalThis.__songMode === 'future' ? 60000 : 0;
          const timestamp = new Date(Date.now() + offset).toISOString().slice(0, 19).replace('T', ' ');
          return new Response(JSON.stringify({status:{code:0},metadata:{type:'realtime',timestamp_utc:timestamp,music:[{
            title:globalThis.__songTitle,artists:[{name:'Artista de prueba'}],duration_ms:200000,play_offset_ms:200000-globalThis.__songRemaining
          }]}}), {headers:{'Content-Type':'application/json'}});
        }
        if (parsed.hostname !== 'www.rtve.es' || !parsed.pathname.startsWith('/servicios/programasRadio/')) return original(url, options);
        const channel = parsed.pathname.split('/').pop().split('.')[0];
        if (globalThis.__programFailure === channel) return new Response('unavailable', {status:503});
        const date = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()).replaceAll('/', '-');
        return new Response(JSON.stringify({emisiones:[{id:channel,programas:{items:[{
          nombre:'Programa de prueba ' + channel,presentador:'Presentador de prueba',
          hora:'00:00',horaFin:'00:00',fechaInicio:date,isNow:true
        }]}}]}), {headers:{'Content-Type':'application/json'}});
      };
    })()`);
  }
  const origin = new URL(worker.url).origin;
  // URL.origin de protocolos no estándar puede ser "null" en Node.
  const extensionUrl = origin === "null" ? worker.url.split("/build/")[0] : origin;
  const openPopup = async () => {
    const page = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(`${extensionUrl}/popup.html`)}`, { method: "PUT" })).json();
    devtools = await new DevTools().connect(page.webSocketDebuggerUrl);
    await waitFor(() => devtools.evaluate("document.querySelector('#play') && !document.querySelector('#play').disabled"));
  };
  const closePopup = async () => {
    await devtools.send('Page.close');
    devtools.close();
    devtools = undefined;
  };
  await openPopup();
  assert.equal(await devtools.evaluate("document.querySelectorAll('.station').length"), 6);
  assert.equal(await devtools.evaluate("document.querySelector('#station-name').textContent"), "Radio Nacional");
  assert.equal(await devtools.evaluate("document.querySelector('#song-request').hidden"), true);
  await waitFor(() => devtools.evaluate("['ready','unavailable'].includes(document.querySelector('#current-program').dataset.status)"));
  // Los títulos deben cargarse en las seis filas antes de seleccionarlas.
  await waitFor(() => devtools.evaluate("[...document.querySelectorAll('.station')].every(button => ['ready','unavailable'].includes(button.dataset.programStatus))"));
  const availability = new Map();
  for (const station of STATIONS) {
    const row = await devtools.evaluate(`(() => {
      const button = document.querySelector('[data-id=${station.id}]');
      return {status:button.dataset.programStatus,text:button.querySelector('.station-description').textContent};
    })()`);
    // Una parrilla real puede estar vacía/caducada al cambiar de programa.
    // Comparar con el proveedor, no exigir datos que RTVE no está publicando.
    let unavailable = station.id === 'rne5';
    if (livePrograms) {
      const response = await devtools.evaluate(`chrome.runtime.sendMessage({target:'background',type:'GET_PROGRAM',stationId:'${station.id}'})`);
      assert.ok(!response.error, JSON.stringify(response));
      unavailable = response.program === null;
    }
    availability.set(station.id, unavailable);
    assert.equal(row.status, unavailable ? 'unavailable' : 'ready', station.id);
    if (!livePrograms) assert.equal(row.text, unavailable ? station.description : `Programa de prueba ${channels[station.id]}`);
  }
  await workerTools.evaluate("chrome.action.setBadgeText({text:'ON'})");
  // Empezar por otra emisora para forzar también el regreso al icono inicial.
  for (const station of [...STATIONS.slice(1), STATIONS[0]]) {
    await devtools.evaluate(`document.querySelector('[data-id=${station.id}]').click()`);
    await waitFor(() => devtools.evaluate(`document.querySelector('#station-name').textContent === ${JSON.stringify(station.name)} && !document.querySelector('#play').disabled`));
    await waitFor(() => workerTools.evaluate(`globalThis.__iconCalls.some(call => call.ok && call.path?.[16]?.endsWith('/icons/${station.id}-16.png'))`));
    assert.equal(await devtools.evaluate("chrome.action.getTitle({})"), `RNE · ${station.name}`);
    assert.equal(await devtools.evaluate("chrome.action.getBadgeText({})"), "");
    const unavailable = availability.get(station.id);
    await waitFor(() => devtools.evaluate(`document.querySelector('#current-program').dataset.status === '${unavailable ? 'unavailable' : 'ready'}'`));
    if (!unavailable) {
      if (!livePrograms) assert.equal(await devtools.evaluate("document.querySelector('#program-name').textContent"), `Programa de prueba ${channels[station.id]}`);
      assert.ok((await devtools.evaluate("document.querySelector('#program-details').textContent")).includes('hora peninsular'));
      assert.equal(await devtools.evaluate(`document.querySelector('[data-id=${station.id}] .station-description').textContent`), await devtools.evaluate("document.querySelector('#program-name').textContent"));
    }
    assert.equal(await devtools.evaluate("document.querySelector('#error').hidden"), true);
  }
  await devtools.evaluate("document.querySelector('[data-id=rner3]').click()");
  await waitFor(() => devtools.evaluate("document.querySelector('#station-name').textContent === 'Radio 3' && !document.querySelector('#play').disabled"));
  assert.equal(await devtools.evaluate("chrome.action.getTitle({})"), "RNE · Radio 3");
  assert.equal(await devtools.evaluate("!document.querySelector('#song-request').hidden && document.querySelector('#request-song').disabled"), true);
  const iconCalls = await workerTools.evaluate("globalThis.__iconCalls");
  const radio3Calls = iconCalls.filter((call) => call.path?.[16]?.includes('rner3-16.png'));
  assert.ok(radio3Calls.some((call) => call.ok), `No se ha aplicado el icono de Radio 3: ${JSON.stringify(iconCalls)}`);
  if (livePrograms) {
    const response = await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'GET_SONG',stationId:'rner3'})");
    assert.ok(!response.error, JSON.stringify(response));
    if (response.song) {
      assert.ok(response.song.detectedAt <= Date.now());
      assert.ok(Date.now() < response.song.expiresAt);
      assert.ok(response.song.expiresAt - response.song.detectedAt <= 60000);
    }
  }
  const volumeResponse = await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'COMMAND',command:{type:'SET_VOLUME',payload:{volume:0.35}}})");
  assert.equal(volumeResponse.state.volume, 0.35);
  if (!livePrograms) {
    const offscreen = await waitFor(async () => (await targets()).find((target) => target.url.endsWith('/offscreen.html')));
    offscreenTools = await new DevTools().connect(offscreen.webSocketDebuggerUrl);
    // Audio simulado solo en esta prueba: ejercitar el flujo real offscreen → worker → popup.
    await offscreenTools.evaluate(`
      HTMLMediaElement.prototype.load = function() {};
      HTMLMediaElement.prototype.play = function() {
        queueMicrotask(() => this.dispatchEvent(new Event('playing')));
        return Promise.resolve();
      };
    `);
    // Avanzar solo el sondeo musical bajo demanda, sin esperar 15 s por caso.
    // Los timers reales de caducidad y el flujo de mensajes no se sustituyen.
    await offscreenTools.evaluate(`(async () => {
      const {browserClock} = await import(chrome.runtime.getURL('build/infrastructure/audio/html-audio.js'));
      const after = browserClock.after.bind(browserClock);
      browserClock.after = (ms, callback) => {
        if (ms !== 15000) return after(ms, callback);
        globalThis.__songPoll = callback;
        return () => { if (globalThis.__songPoll === callback) globalThis.__songPoll = undefined; };
      };
    })()`);
  }
  const playResponse = await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'COMMAND',command:{type:'PLAY'}})");
  assert.ok(["loading", "playing", "buffering"].includes(playResponse.state.status));
  assert.equal(await devtools.evaluate("chrome.action.getBadgeText({})"), "");
  if (!livePrograms) {
    const visibleSong = (title) => devtools.evaluate(`!document.querySelector('#current-song').hidden && document.querySelector('#song-title').textContent === ${JSON.stringify(title)}`);
    const sharedSong = async () => (await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'GET_PLAYBACK_METADATA'})")).metadata.song;
    const pollSong = async () => {
      await waitFor(() => offscreenTools.evaluate("typeof globalThis.__songPoll === 'function'"));
      await offscreenTools.evaluate("(() => { const poll = globalThis.__songPoll; globalThis.__songPoll = undefined; poll(); })()");
      await waitFor(() => offscreenTools.evaluate("typeof globalThis.__songPoll === 'function'"));
    };
    await waitFor(() => visibleSong('Canción de prueba'));
    await waitFor(() => devtools.evaluate("getComputedStyle(document.querySelector('#play-icon')).display === 'none' && getComputedStyle(document.querySelector('#stop-icon')).display !== 'none'"));
    await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => title.includes('Programa de prueba R3') && title.includes('Canción de prueba — Artista de prueba'))"));
    const initialSong = await sharedSong();
    const calls = await workerTools.evaluate("globalThis.__songCalls");
    assert.equal(calls, 1, 'Solo offscreen debe consultar la fuente musical');
    // La fuente puede fallar en la próxima consulta. Reabrir no debe hacer esa consulta
    // ni perder/renovar el reconocimiento que offscreen todavía mantiene vigente.
    await workerTools.evaluate("globalThis.__songMode = 'error'");
    for (let i = 0; i < 3; i++) {
      await closePopup();
      await openPopup();
      await waitFor(() => visibleSong('Canción de prueba'));
      assert.deepEqual(await sharedSong(), initialSong);
      assert.equal(await workerTools.evaluate("globalThis.__songCalls"), calls);
    }
    const again = await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'COMMAND',command:{type:'SELECT_STATION',payload:{stationId:'rner3'}}})");
    assert.equal(again.state.status, 'playing');
    assert.equal(await devtools.evaluate("document.querySelector('#error').hidden"), true);
    await workerTools.evaluate("globalThis.__songMode = 'fresh'; globalThis.__songTitle = 'Segunda canción de prueba'; globalThis.__songRemaining = 2000");
    await pollSong();
    await waitFor(() => visibleSong('Segunda canción de prueba'));
    await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => title.includes('Segunda canción de prueba'))"));
    await closePopup();
    await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => !title.includes('canción de prueba'))"));
    assert.ok((await workerTools.evaluate("chrome.action.getTitle({})")).includes('Programa de prueba R3'));
    await openPopup();
    assert.equal(await sharedSong(), null, 'No restaurar la canción caducada al reabrir');
    assert.equal(await devtools.evaluate("document.querySelector('#current-song').hidden"), true);
    for (const mode of ['old', 'future', 'error']) {
      await workerTools.evaluate(`globalThis.__songMode = '${mode}'`);
      await pollSong();
      assert.equal(await sharedSong(), null);
      assert.equal(await devtools.evaluate("document.querySelector('#current-song').hidden"), true);
      assert.equal(await devtools.evaluate("document.querySelector('#current-program').dataset.status"), 'ready');
    }
    // No es una identificación de un solo uso: otra canción aparece tras caducar/fallar.
    await workerTools.evaluate("globalThis.__songMode = 'fresh'; globalThis.__songTitle = 'Tercera canción de prueba'; globalThis.__songRemaining = 10000");
    await pollSong();
    await waitFor(() => visibleSong('Tercera canción de prueba'));
    await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => title.includes('Tercera canción de prueba'))"));
    // El botón hace una consulta real inmediata por el mismo propietario, no otro snapshot.
    const requestSong = async () => {
      const calls = await workerTools.evaluate("globalThis.__songCalls");
      await devtools.evaluate("document.querySelector('#request-song').click(); document.querySelector('#request-song').click()");
      assert.equal(await devtools.evaluate("document.querySelector('#request-song').disabled && document.querySelector('#request-song').textContent === 'Consultando…'"), true);
      await waitFor(() => workerTools.evaluate(`globalThis.__songCalls === ${calls + 1}`));
      await waitFor(() => devtools.evaluate("!document.querySelector('#request-song').disabled"));
      assert.equal(await workerTools.evaluate("globalThis.__songCalls"), calls + 1, 'Sin duplicar por doble clic');
      const state = await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'COMMAND',command:{type:'GET_STATE'}})");
      assert.equal(state.state.status, 'playing', 'La consulta musical no cambia el audio');
      assert.equal(await devtools.evaluate("document.querySelector('#error').hidden"), true);
      assert.equal(await devtools.evaluate("document.querySelector('#current-program').dataset.status"), 'ready');
      return devtools.evaluate("document.querySelector('#song-request-message').textContent");
    };
    await workerTools.evaluate("globalThis.__songTitle = 'Canción solicitada'; globalThis.__songDelay = 200");
    assert.equal(await requestSong(), '');
    await waitFor(() => visibleSong('Canción solicitada'));
    await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => title.includes('Canción solicitada'))"));
    for (const mode of ['old', 'future', 'error']) {
      await workerTools.evaluate(`globalThis.__songMode = '${mode}'`);
      const message = await requestSong();
      assert.match(message, mode === 'error' ? /No se ha podido consultar RTVE/ : /RTVE no ofrece una identificación reciente/);
      assert.equal(await devtools.evaluate("document.querySelector('#current-song').hidden"), true);
    }
    await workerTools.evaluate("globalThis.__songMode = 'fresh'; globalThis.__songTitle = 'Canción tras reintentar'");
    assert.equal(await requestSong(), '');
    await waitFor(() => visibleSong('Canción tras reintentar'));
  }
  const stopped = await (offscreenTools ?? devtools).evaluate("chrome.runtime.sendMessage({target:'background',type:'COMMAND',command:{type:'STOP'}})");
  assert.equal(stopped.state.status, "stopped");
  await waitFor(() => devtools.evaluate("document.querySelector('#request-song').disabled"));
  await waitFor(() => devtools.evaluate("getComputedStyle(document.querySelector('#stop-icon')).display === 'none' && getComputedStyle(document.querySelector('#play-icon')).display !== 'none' && document.querySelector('#current-song').hidden"));
  await waitFor(() => workerTools.evaluate("chrome.action.getTitle({}).then(title => title === 'RNE · Radio 3')"));
  await waitFor(() => workerTools.evaluate("chrome.storage.local.get('stationId').then(s => s.stationId === 'rner3')"));
  console.log(`Smoke OK: extensión real, títulos en las seis filas y el reproductor, programación ${livePrograms ? 'real de RTVE' : 'con fixtures y fallo HTTP simulado'}, iconos aplicados por setIcon, sin badge ON, canciones recientes y ocultación de caducadas, ${livePrograms ? 'metadatos reales y fallback sin datos vigentes' : 'reaperturas sin consultas duplicadas, canciones sucesivas y tooltip sin popup, botón de consulta manual y reintentos, iconos PLAY/STOP visibles correctos'}, offscreen, volumen y persistencia.`);
} catch (error) {
  if (devtools) {
    console.error('Diagnóstico de programación:', await devtools.evaluate("({status:document.querySelector('#current-program')?.dataset.status,text:document.querySelector('#program-name')?.textContent})").catch(() => null));
    console.error('Respuesta GET_PROGRAM:', await devtools.evaluate("chrome.runtime.sendMessage({target:'background',type:'GET_PROGRAM',stationId:'rne1'})").catch((error) => error.message));
  }
  throw error;
} finally {
  devtools?.close();
  workerTools?.close();
  offscreenTools?.close();
  if (process.platform === "win32" && processHandle.pid) {
    try { execFileSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ya terminado */ }
  } else processHandle.kill();
  await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
