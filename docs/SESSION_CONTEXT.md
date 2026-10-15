# Contexto para retomar el desarrollo de RNE Radio

Este archivo es un resumen de trabajo, no una copia íntegra de la conversación. Conviene actualizarlo al terminar cambios importantes y contrastarlo con el código antes de modificarlo.

## Proyecto y preferencias del usuario

- Extensión independiente Manifest V3 para Chrome, Brave, Helium y otros Chromium 116+.
- Carpeta instalada: `C:\Users\Carlos\Documents\Carlos\Dev\rne-radio`.
- La sesión de Pi se inició en `C:\Users\Carlos\Documents\Carlos\Dev` (carpeta padre del proyecto).
- Comunicarse en español. Preferencia por arquitectura escalable y comprensible, TypeScript estricto y puertos/adaptadores sin frameworks innecesarios.
- Mantener logos oficiales locales, icono dinámico de emisora, volumen y ajustes, reproducción fuera del popup y programación.
- No poner badge «ON» sobre el icono.
- Si ya se ha compilado, indicar solo **↻ Recargar** en la tarjeta de la extensión. No reinstalar ni cargar `build/`: se carga siempre la raíz del proyecto. Recargar corta la reproducción.

## Estado actual: versión 2.4.0

- Manifest y archivos npm actualizados. Compilación local disponible en `build/`.
- Seis emisoras: `rne1`, `rner3`, `rner4`, `rnerc`, `rne5`, `rneree`.
- Audio persistente en documento offscreen; popup descartable y worker suspendible. Recuerda emisora/volumen, pero no inicia audio al arrancar el navegador.
- Logos SVG locales en `assets/logos/` y PNG de barra por emisora en `icons/`.
- El icono de barra cambia incluso con reproducción detenida. La tarjeta de extensiones mantiene el icono general.
- Programa actual, presentador y horario peninsular para las seis emisoras. El título aparece en todas las filas, sin seleccionarlas. La lista y el programa seleccionado comparten los datos del popup.
- Radio 3 muestra título y artista recientes, sin el rótulo «CANCIÓN IDENTIFICADA».
- Tooltip de barra durante la reproducción: emisora, nombre del programa y canción/artista recientes de Radio 3 cuando están disponibles. Al detener queda solo la emisora.
- El tooltip se actualiza y retira canciones caducadas aunque el popup esté cerrado, mediante controladores y timers en offscreen.
- Reseleccionar la emisora actual es un no-op: no reinicia audio ni metadatos.
- Buffering breve conserva una identificación aún vigente. Volver a Radio 3 puede recuperar la última identificación mientras siga vigente, sin renovar su caducidad. Nunca mostrarla en otra emisora.
- Botón corregido: stop durante reproducción/conexión, play al detener. El fallo era usar `.hidden` sobre SVG; ahora se usa `toggleAttribute("hidden", ...)`. Verificado con estilos computados en navegador.
- Corrección 2.3.1 del título que desaparecía al reabrir: solo offscreen mantiene las consultas a RTVE. El popup recupera su snapshot y escucha eventos `METADATA_CHANGED`; ya no hace otra consulta HTTP al abrirse. Una respuesta de snapshot pendiente no puede borrar una actualización recibida después. Se probaron tres reaperturas sin nuevas peticiones y tres canciones sucesivas, incluida recuperación tras errores.

- Novedad 2.4: botón «Obtener título de canción» al seleccionar Radio 3. Desactivado en reposo; activo durante reproducción/buffering. Consulta inmediatamente RTVE a través del propietario offscreen, comparte una petición ya en curso y mantiene un único sondeo automático. Muestra «Consultando…», comunica falta de identificación reciente o error y permite reintentar, sin tocar audio/programa ni añadir permisos o reconocimiento externo.

## Requisito imprescindible sobre canciones

**El usuario no quiere ver títulos antiguos porque confunden.** No mostrar «última canción identificada» como alternativa.

- Validez máxima: menos de 60 segundos desde `metadata.timestamp_utc`, no desde la descarga ni desde la fecha HTTP.
- Fechas futuras, inválidas, datos vacíos o errores: ocultar información musical.
- Duración y posición, cuando existen, pueden adelantar la caducidad.
- Timer de caducidad independiente del sondeo: una consulta pendiente no prolonga la canción.
- Sondeo aproximadamente 15 segundos después de cada respuesta; timeout de proveedor de 5 segundos.
- Programa y audio independientes de los errores musicales.
- La fuente de identificación no garantiza sincronía exacta con el MP3. No hay fuente musical verificada para las otras cinco emisoras.

## Fuentes y permisos

### Programas

`https://www.rtve.es/servicios/programasRadio/R3.json?emision=ahora-sig`

Mapeo: `rne1:R1`, `rnerc:R2`, `rner3:R3`, `rner4:R4`, `rne5:R5`, `rneree:R6`.

Datos en `emisiones[].programas.items[]`: `nombre`, `presentador`, `hora`, `horaFin`, `isNow`, posible `fechaInicio`. Zona `Europe/Madrid`.

Proveedor con timeout de 8 segundos, sin cookies/referrer, single-flight y caché de hasta 45 segundos (15 para null), nunca más allá del fin del programa.

### Canciones de Radio 3

`https://nowplaying.rtve.es/radio3.json`

Descubierto mediante inspección estática de un APK de Radio 3, sin instalarlo/ejecutarlo ni acceder al teléfono del usuario. La configuración oficial `https://www.rtve.es/m/configs/radio3/2026/estructura.json` lo referencia en `radioPrincipal.identificadorCanciones`.

Ejemplo de esquema:

```json
{"status":{"code":0},"metadata":{"type":"realtime","timestamp_utc":"2026-10-15 20:26:25","music":[{"title":"Cuervos","artists":[{"name":"Oscar Avendaño & Reposado"}],"duration_ms":254000,"play_offset_ms":152920},{"URLimagen":"..."}]}}
```

No todos los elementos de `music` son canciones. Se observaron respuestas con identificaciones de unos diez minutos de antigüedad, incluso con HTTP 200, `type: realtime` y score alto. No se determinó la causa.

Permisos actuales: `offscreen`, `storage`, hosts `https://www.rtve.es/*` y `https://nowplaying.rtve.es/*`. No micrófono, historial ni envío de audio a reconocedores. No descargar portadas ni contactar con servicios externos citados en la respuesta.

## Arquitectura y archivos principales

- `src/domain/`: estaciones, estado, programas, canciones, `toolbar-metadata.ts` con validación y formato del tooltip.
- `src/application/radio-player.ts`: propietario del estado del audio.
- `background-service.ts`: ajustes, host de audio e icono.
- `popup-controller.ts`: estado aceptado, concurrencia, comandos y volumen.
- `program-controller.ts`: ciclo de consulta de un programa, reutilizado en popup y offscreen.
- `station-programs-controller.ts`: comparte programas entre las seis filas y la selección.
- `song-controller.ts`: frescura, sondeo, cache reciente de retorno, caducidad independiente y recepción de actualizaciones con protección ante snapshots tardíos. `refreshNow()` comparte un Promise por revisión con el sondeo y propaga errores al solicitante manual sin detener los siguientes sondeos.
- `song-request-controller.ts`: acción manual, disponibilidad del botón, doble clic y mensajes; descarta respuestas tardías al parar/cambiar emisora/cerrar. Usa `SongRefresher` y `SongRequestView`.
- `playback-metadata-controller.ts`: estado musical compartido del popup/tooltip ligado al audio en offscreen; `snapshot()` vuelve a comprobar frescura aunque se haya retrasado un timer.
- `infrastructure/chrome/playback-song-client.ts`: el popup lee `GET_PLAYBACK_METADATA` (worker) → `GET_METADATA` (offscreen), sin consultar RTVE. Sigue leyendo snapshots cada 15 segundos como respaldo; solo offscreen hace sondeo HTTP. La acción explícita `refresh()` envía `REFRESH_PLAYBACK_SONG` (worker) → `REFRESH_SONG` (offscreen) → `PlaybackMetadataController.refreshSong()`.
- `src/infrastructure/rtve/`: proveedores de programación y música.
- `src/infrastructure/chrome/`: mensajes validados, clientes runtime, almacenamiento y toolbar.
- `ChromeToolbar.showMetadata`: serializa tooltip con iconos e ignora metadatos de otra emisora. El formato vuelve a validar frescura.
- `src/presentation/popup-view.ts`: DOM mediante `textContent`, nunca HTML remoto.
- `src/entries/player.ts`: compone audio y controlador de metadatos; publica `UPDATE_METADATA` al worker y `METADATA_CHANGED` al popup. `GET_STATE` también repone metadatos al reconectar; `GET_METADATA` devuelve el estado compartido.
- `src/entries/background.ts`: atiende programación, música y metadatos del tooltip. La restauración inicial del icono termina antes de aplicar metadatos.
- `src/entries/popup.ts`: composición de la interfaz y sus controladores descartables.
- Runtime: `build/entries/background.js`, `build/entries/player.js`, `build/entries/popup.js`.

### Errores resueltos que no deben reintroducirse

- `chrome.action.setIcon`: usar URLs absolutas mediante `chrome.runtime.getURL(file)`; rutas relativas se resuelven desde `build/entries/` y fallaban.
- `fetch` del worker debe conservar receptor global: wrapper de `globalThis.fetch` y llamada con `.call(globalThis, ...)`, para evitar «Illegal invocation».
- SVG: alternar atributo `hidden`, no propiedad `HTMLElement.hidden`.
- No depender de timers permanentes del service worker para mantener/caducar metadatos.

## Validación más reciente

- `npm run check`: **95 pruebas pasadas**, TypeScript estricto correcto.
- `npm run test:browser`: smoke en Brave headless, perfil temporal y sonido silenciado. Incluye fixtures, error HTTP, iconos, visibilidad real de play/stop, tres reaperturas sin perder el reconocimiento vigente ni aumentar las peticiones, canciones sucesivas y recuperación tras errores. Comprueba caducidad sin popup y que una canción vencida no reaparezca al volver a abrir. También prueba el botón manual con respuesta reciente, antigua, futura y error, reintentos sin duplicar doble clic, actualización del tooltip y continuidad de audio/programa.
- `node tools/smoke-browser.mjs --live-programs`: pasado con RTVE real, incluido fallback ante datos sin vigencia.
- La parrilla real puede devolver null al cambiar de programa; el smoke compara con el proveedor en vez de exigir que todas las emisoras publiquen siempre programa vigente.
- El smoke con fixtures simula audio para probar el flujo; no acredita calidad de sonido ni sustituye comprobación manual en cada navegador.

## Comandos

Desde `rne-radio`:

```sh
npm ci
npm run build
npm run watch
npm run check
npm run test:browser
npm run test:browser -- --live-programs
npm run icons
```

`build/` y `node_modules/` son generados e ignorados en Git. No editar JS compilado a mano.

## Git y entrega inicial

- Repositorio Git inicializado y remoto privado creado: `https://github.com/carlosYoko/rne-radio` (cuenta `carlosYoko`, remoto `origin`).
- Rama principal de producción: `main`. Antes de integrar la entrega inicial solo contiene el commit base de exclusiones Git.
- Rama de entrega: `feat/initial-extension`. El usuario ha pedido una PR y **la fusionará él**; no fusionarla automáticamente.
- El estado existente de 2.4.0 se ha separado en commits ordenados: configuración, dominio, aplicación/puertos, audio, RTVE, Chrome, composición/interfaz/recursos, pruebas, herramientas, CI y documentación. No se ha inventado historial previo; los pasos intermedios no son versiones completas compilables.
- Se recomienda **Create a merge commit** para conservar los commits por capas, no squash.
- `.github/workflows/ci.yml`: Node.js 22, `npm ci` y `npm run check` en PR a `main` y push a `main`. Smoke de navegador solo local.
- Antes de preparar la PR se han repetido `npm run check` (95 pruebas y tipos correctos) y `npm run test:browser` (pasado). No se ha repetido el modo `--live-programs` en esta entrega.
- `.gitignore` también excluye archivos de entorno, claves locales, logs y metadatos del sistema. Una búsqueda de patrones habituales no encontró credenciales en los archivos fuente a versionar.

Documentación complementaria: `README.md`, `docs/architecture.md`, `docs/now-playing-investigation.md`.

## Cómo retomar

En una nueva sesión, pedir:

> Lee `rne-radio/docs/SESSION_CONTEXT.md` y revisa los archivos pertinentes antes de continuar con la extensión RNE.

Último pedido implementado: añadir el botón «Obtener título de canción». La 2.4.0 hace una consulta explícita a la fuente existente de RTVE, compartida con offscreen, sin esperar al siguiente sondeo y sin mostrar datos antiguos. Compilada y validada. Pedido posterior: ordenar commits, crear remoto privado y abrir una PR hacia `main`, dejando la fusión al usuario (ver «Git y entrega inicial»).

Se había explicado también la opción de identificar audio bajo demanda mediante ACRCloud/AudD u otro servicio externo. **No se ha implementado ni autorizado contratar un proveedor o enviar audio a terceros.** Si se retoma esa alternativa, evaluar permisos/captura, privacidad, costes, calidad y protección de credenciales; no incrustar una clave secreta compartida en la extensión. El botón actual no fuerza al servidor a realizar un reconocimiento nuevo: solo solicita su información disponible.

Limitación externa que no debe confundirse con perder estado: el 15 de octubre de 2026 a las 21:06:40 UTC se observó HTTP 200 con identificación de las 21:01:46 («Élan - Live», Nightwish), casi cinco minutos antigua. Se descarta. El límite de 60 segundos no se ha ampliado; puede ocultar el título aunque siga la misma canción si RTVE no renueva el timestamp. No prometer continuidad de títulos cuando la fuente no ofrece información fresca.
