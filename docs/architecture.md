# Arquitectura de RNE Radio

## Objetivo y alcance

Facilitar cambios y pruebas sin mezclar reproducción, mensajes de Chrome, preferencias y renderizado. Se adopta una arquitectura de puertos y adaptadores **pragmática**: sin framework, bus genérico, jerarquías de herencia, DI container ni una clase por cada botón.

La escalabilidad aquí es de **funciones y mantenimiento**, no de tráfico de un servidor. Cada navegador ejecuta una sola instancia de audio en su documento offscreen.

## ¿Por qué TypeScript?

JavaScript es perfectamente válido para extensiones pequeñas. TypeScript aporta valor cuando hay varios contextos y contratos compartidos:

- `StationId` solo admite los identificadores del catálogo.
- `PlayerCommand` es una unión discriminada: cada comando exige su payload correspondiente.
- `PlayerState` y `Settings` definen el estado compartido.
- Los puertos comprueban las implementaciones de audio, ajustes, cliente y vista.
- `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` detectan estados incompletos y accesos inseguros durante el desarrollo.

El coste es un paso de compilación y herramientas de desarrollo. Los tipos se eliminan; **no** se ejecuta TypeScript en Chrome ni se añade una librería de runtime. Tampoco reemplaza las pruebas ni valida automáticamente datos de `storage` o mensajes externos: esos límites se comprueban en ejecución.

## Capas y dirección de dependencias

```text
entries ──────→ application ──────→ domain
   │                ↑                 ↑
   ├──→ infrastructure ────────────────┘
   └──→ presentation ────────────────→ domain
              └──→ application (contratos)
```

- **Dominio** (`domain/`): catálogo, identidad de emisoras, estado, comandos, validación y reglas de volumen. No conoce Chrome ni audio HTML.
- **Aplicación** (`application/`): casos de uso y puertos. No conoce el transporte de mensajes ni cómo se renderiza el popup.
- **Infraestructura** (`infrastructure/`): implementa los puertos con APIs de Chrome y del navegador. Aquí vive el protocolo de transporte, porque no es una regla de reproducción.
- **Presentación** (`presentation/`): crea los botones, mantiene accesibilidad y refleja el estado en HTML.
- **Composición** (`entries/`): instancia las clases y conecta mensajes, eventos y vistas. Son los únicos módulos iniciados directamente por el manifest/HTML.

`tests/architecture.test.js` protege la ausencia de dependencias de Chrome/DOM en dominio y aplicación, y comprueba que todos los imports de ejecución son locales y resuelven a archivos existentes.

## Responsabilidades principales

| Componente | Responsabilidad |
| --- | --- |
| `RadioPlayer` | Único propietario del estado de reproducción. Ejecuta comandos y publica snapshots. |
| `BackgroundService` | Coordina host de reproducción, preferencias y representación en la barra. |
| `PopupController` | Coordina peticiones y eventos, evita snapshots obsoletos y agrupa cambios de volumen. |
| `PopupView` | Renderiza HTML y transforma eventos DOM en acciones del controlador. |
| `ProgramController` | Consulta la programación con ciclo de vida explícito (popup u offscreen), refresca y descarta datos caducados o respuestas antiguas. |
| `PlaybackMetadataController` | Mantiene programa y canción del tooltip mientras suena la radio, incluso sin popup. |
| `RuntimeProgramClient` | Solicita programas al worker con el mensaje tipado `GET_PROGRAM`. |
| `RtveProgramProvider` | Consulta y valida la parrilla de RTVE, resuelve horarios peninsulares y aplica caché y single-flight. |
| `HtmlAudioEngine` | Traduce operaciones del reproductor a `HTMLAudioElement`. |
| `ChromeSettingsRepository` | Lee y escribe preferencias en `chrome.storage.local`. |
| `RemoteSettingsRepository` | Accede a preferencias desde offscreen mediante mensajes al worker. |
| `RuntimePlayerClient` | Envía comandos del popup al worker. |
| `OffscreenPlayerHost` | Asegura un documento de audio y envía comandos a ese documento. |
| `ChromeToolbar` | Actualiza icono y tooltip, limpia badges antiguos, serializa iconos y evita cambios redundantes. |

Las dependencias se inyectan mediante constructores, usando interfaces de `application/ports.ts`. No hay localizador global de servicios. Los objetos concretos se crean solo en los entrypoints.

## Tres contextos de ejecución

### Popup

Puede abrirse y cerrarse en cualquier momento. **No posee el audio ni su estado autoritativo.**

1. `entries/popup.ts` conecta `PopupView`, `PopupController` y `RuntimePlayerClient`.
2. Solicita `GET_STATE` al abrirse.
3. Envía comandos y recibe snapshots del reproductor.
4. Cerrar el popup solo elimina la interfaz, no detiene la radio.

### Service worker

Chrome puede suspenderlo. No conserva el audio ni depende de variables en memoria para recuperar preferencias.

1. `entries/background.ts` registra listeners sincrónicamente, antes de esperar promesas.
2. Valida mensajes y delega en `BackgroundService`.
3. El adaptador offscreen reutiliza el documento existente o lo crea con single-flight.
4. Al despertar, restaura el icono desde almacenamiento y limpia badges antiguos.
5. Al instalar o iniciar el navegador, restaura el icono sin reproducir audio. No se utiliza un badge «ON», para no tapar el logo.

### Documento offscreen

Mantiene `RadioPlayer` y `HtmlAudioEngine`. El navegador puede destruirlo tras aproximadamente 30 segundos sin audio.

1. Carga preferencias por mensajes al worker, ya que offscreen solo tiene acceso a la API de extensiones `chrome.runtime`.
2. Inicializa volumen y emisora, pero no empieza a reproducir.
3. Los comandos esperan a que finalice esa inicialización.
4. Publica snapshots para el popup y el worker.
5. Media Session dirige sus acciones a los mismos comandos del reproductor.

## Flujo: seleccionar una emisora

```text
PopupView: clic
  → PopupController.command(SELECT_STATION)
  → RuntimePlayerClient
  → mensaje al worker
  → BackgroundService
  → OffscreenPlayerHost.ensure() + execute()
  → mensaje al offscreen
  → RadioPlayer.execute()
      ├─ actualiza emisora
      ├─ encola persistencia por Repository
      ├─ cambia la señal solo si ya estaba activa
      └─ publica snapshot
          ├─ popup: render de nombre, logo y estado
          └─ worker: icono y tooltip, sin badge superpuesto
```

El retorno del comando también contiene un snapshot, pero no debe sustituir un evento más reciente.

## Estado y concurrencia

Estados explícitos: `stopped`, `loading`, `playing`, `buffering`, `error`.

- `PLAY` conecta al directo y pasa a `loading`.
- El evento `playing` confirma audio y cancela el timeout.
- `waiting` pasa a `buffering` y vigila la conexión.
- `STOP` libera la señal y pasa a `stopped`.
- Timeout de 25 segundos, `error` o `ended` liberan la conexión y pasan a `error`.
- Seleccionar una emisora en reposo conserva el reposo; seleccionarla en reproducción inicia su señal.
- Cada intento incrementa una generación: el rechazo de una promesa de audio antigua no puede detener una señal nueva.
- Las escrituras de ajustes se serializan y capturan una copia de los valores.
- Los iconos se serializan para no terminar con un resultado antiguo de una llamada lenta.
- Las rutas que se pasan a `chrome.action.setIcon` se convierten en URLs absolutas mediante `chrome.runtime.getURL`, ya que el worker vive en `build/entries/` y las rutas relativas podrían resolverse desde ese subdirectorio.
- El smoke comprueba que `setIcon` realmente termina con éxito para cada emisora: un tooltip correcto no garantiza que se haya cargado la imagen.
- Las escrituras retrasadas de ajustes no cambian el icono: la fuente visual es el estado actual del reproductor.
- Worker y popup utilizan revisiones para no reemplazar eventos nuevos con respuestas antiguas.
- El popup mantiene bloqueados los comandos exclusivos mientras se procesan, pero permite agrupar cambios de volumen.

No se aplica un State Pattern basado en una clase por estado: para cinco estados y estas transiciones, una unión de tipos y una clase con operaciones explícitas es más fácil de mantener.

## Protocolo y validación

`infrastructure/chrome/messages.ts` centraliza:

- Uniones de mensajes de worker, reproductor y popup.
- Guardas que aceptan `unknown` y validan target, tipo, payload, emisora, volumen y estado.
- Lectura segura de respuestas y conversión de errores.

Cada listener comprueba que el emisor pertenece a la misma extensión. No se registra `onMessageExternal`. No se añade un sistema RPC ni una dependencia de esquemas para este protocolo pequeño.

La ausencia de un popup abierto al publicar eventos no es un fallo. Los problemas cosméticos del icono o badge tampoco deben convertir una reproducción válida en un error. Si los ajustes no están disponibles, el reproductor usa valores predeterminados; los fallos de persistencia no detienen la radio.

## Añadir funciones

### Nueva emisora

1. Añadirla a `domain/stations.ts`: id, nombre, descripción, color y SVG local.
2. Comprobar la URL de su señal; si no sigue la ruta actual, extender la resolución de streams explícitamente.
3. Ejecutar `npm run icons` para generar sus PNG.
4. Ajustar el contador visual de `popup.html` y las pruebas que esperan seis emisoras.
5. Ejecutar `npm run check` y probar audio e icono manualmente.

El tipo `StationId`, el selector y las rutas de iconos se derivan del catálogo. Los logos no se descargan durante el uso.

### Temporizador de apagado

Añadir su contrato/caso de uso a aplicación y comandos correspondientes. El temporizador que detiene audio debe vivir con `RadioPlayer` en offscreen, no en el popup ni depender de que el worker permanezca activo. Inyectar reloj para probarlo sin esperar tiempo real.

### Programación en directo (desde 2.1)

Se utiliza el puerto `ProgramProvider` y un `ProgramController` independiente del audio:

```text
Estado aceptado por PopupController
  → StationProgramsController.select(stationId) [selección sin nueva consulta]

Al abrir el popup, StationProgramsController.start()
  → un ProgramController por emisora
  → RuntimeProgramClient
  → GET_PROGRAM en el worker
  → RtveProgramProvider
  → https://www.rtve.es/servicios/programasRadio/Rn.json?emision=ahora-sig
  → CurrentProgram | null
  → PopupView.renderStationProgram(stationId, state)
  → PopupView.renderProgram(state) solo si esa emisora está seleccionada
```

- `StationProgramsController` inicia una consulta por emisora al abrir el popup y comparte cada respuesta entre la fila y el reproductor. Cambiar la selección no inicia peticiones adicionales. Cada `ProgramController` refresca aproximadamente cada 60 segundos después de cada respuesta. Si el programa termina antes, adelanta la siguiente consulta y oculta el dato vencido. No crea nuevos sondeos al cambiar el volumen o estado del audio.
- El reloj reside en el popup. Al cerrar se cancelan temporizadores e ignoran respuestas pendientes, sin afectar a la radio ni mantener sondeos en un worker suspendible.
- El proveedor usa un timeout de 8 segundos y no envía cookies ni referrer. La caché en memoria dura como máximo 45 segundos (15 para resultados sin programa) y nunca supera el fin del programa; se pierde sin consecuencias al suspenderse el worker.
- Las peticiones concurrentes a la misma emisora comparten una consulta. Cada respuesta actualiza su fila y solo actualiza el reproductor si corresponde a la selección actual. Si falla una emisora, las demás siguen mostrando sus programas; su fila conserva la descripción habitual.
- El parser solo acepta el canal solicitado y un programa `isNow: true` que coincida con fecha y horario, cuando esos datos están disponibles. `Europe/Madrid` interpreta el horario peninsular, con pruebas de medianoche y cambio de hora. Los periodos o fechas incoherentes producen `null`.
- El presentador es un dato de programa, no un artista. Los textos se pintan mediante `textContent`, sin interpretar HTML externo. No se descargan portadas remotas.
- `chrome.runtime` valida el ID de emisora y el formato de respuesta. El manifest declara acceso a `https://www.rtve.es/*`; no hay permisos de host para terceros.
- El adaptador conserva el receptor global al invocar `fetch`, necesario en workers para evitar errores de «Illegal invocation».
- Un error HTTP, timeout, permiso no concedido o esquema inesperado muestra «Programación no disponible», sin modificar `PlayerState` ni detener el audio.

### Canciones de Radio 3 (desde 2.2)

```text
RadioPlayer → PlaybackMetadataController en offscreen
  → SongController.update(state) [Radio 3 + playing/buffering]
  → RuntimeSongClient → GET_SONG → RtveSongProvider
  → https://nowplaying.rtve.es/radio3.json
  → CurrentSong | null → snapshot compartido + eventos
  → tooltip y PopupView.renderSong(song)

Popup al abrir / respaldo cada 15 s (sin nueva consulta HTTP)
  → RuntimePlaybackSongClient → GET_PLAYBACK_METADATA (worker)
  → GET_METADATA (offscreen) → PlaybackMetadataController.snapshot()
  → CurrentSong | null → SongController del popup

METADATA_CHANGED (offscreen → popup)
  → SongController.receive(song) → render inmediato
```

- `CurrentSong` incluye título, artistas, `detectedAt` y `expiresAt`. `SONG_MAX_AGE_MS` fija 60 segundos; `isFreshSong` exige `detectedAt <= now < expiresAt`. No se acepta información de otras emisoras ni fechas futuras.
- El parser exige estado correcto, metadatos `realtime`, fecha UTC válida y canción con título/artistas. Ignora entradas sin título, como portadas. Usa la fecha del contenido, nunca la fecha de descarga o la cabecera HTTP. Duración y posición pueden reducir el plazo; si esos campos se publican inconsistentes, se descarta el candidato.
- Sondeo 15 segundos después de cada respuesta, solo mientras se necesita mostrar la canción. El proveedor tiene timeout de 5 segundos, single-flight sin caché persistente y `fetch` sin cookies, referrer ni caché de navegador. Su host específico se declara en el manifest.
- La caducidad tiene un timer separado del sondeo: una consulta pendiente nunca prolonga una identificación. Se vuelve a comprobar la fecha después de cada consulta y al recuperar visibilidad/foco. Parar, cambiar emisora, error o cerrar el propietario limpia la vista y cancela timers; revisiones invalidan respuestas pendientes. Un buffering breve conserva la identificación solo hasta su caducidad original. Volver a Radio 3 puede reutilizar la última identificación válida mientras se consulta, sin renovar su plazo; una respuesta vacía o fallida también invalida esa copia.
- Datos antiguos, futuros, vacíos, inválidos o errores ocultan toda la tarjeta musical. No se conserva «última canción identificada». El programa y audio siguen independientes. Los textos se insertan con `textContent`; no se descargan portadas ni se envía audio.
- El umbral es conservador y no acredita sincronía exacta con el MP3. No hay fuente de canciones verificada para las otras cinco emisoras.

Para añadir otro proveedor, verificar la fuente y mantener estos límites. No introducir llamadas HTTP en la vista ni acoplar el audio al éxito del proveedor.

### Tooltip en directo (desde 2.3)

`entries/player.ts` conecta `PlaybackMetadataController` al estado de `RadioPlayer`. Mientras la reproducción está activa mantiene un `ProgramController` de la emisora seleccionada y un `SongController` para Radio 3. Los proveedores son los clientes runtime del worker; los timers viven con el audio, no en un worker que puede suspenderse. Al detener o fallar se cancelan y se publica solo la emisora.

Cada actualización envía `UPDATE_METADATA` al worker y `METADATA_CHANGED` al popup, con `ToolbarMetadata` validado. `ChromeToolbar.showMetadata` serializa el tooltip con los iconos y descarta metadatos de una emisora que ya no está seleccionada. `toolbarTitle` vuelve a comprobar caducidad al renderizar. El texto contiene emisora, nombre del programa y, si procede, canción y artista. El timer de caducidad de canción publica su retirada aunque se haya cerrado el popup o esté pendiente otra consulta. `GET_STATE` repone los metadatos al reconectar el popup/worker.

Desde 2.3.1, el controlador musical del popup es una proyección del estado compartido: su proveedor `RuntimePlaybackSongClient` lee un snapshot de offscreen al abrir y cada 15 segundos como respaldo, sin consultar RTVE. Los eventos `METADATA_CHANGED` actualizan la tarjeta inmediatamente. Un contador de eventos impide que una lectura pendiente, antigua o fallida sustituya una actualización recibida después; el respaldo sigue programándose aunque ocurra esa carrera. El snapshot vuelve a validar caducidad aunque se haya retrasado un timer. El popup mantiene su timer local de caducidad, pero cerrar su controlador no destruye el de offscreen ni pierde la identificación compartida.

El proveedor de programas comparte caché y single-flight entre ambos clientes. No se amplían permisos. El tooltip no conserva programas/canciones al detener, evitando dejar información indefinidamente después de que el navegador destruya offscreen por silencio.

`SELECT_STATION` con la emisora actual es un no-op para no reiniciar la señal. Los iconos SVG del botón usan `toggleAttribute("hidden", ...)`, porque `SVGElement` no dispone de la propiedad `HTMLElement.hidden`. El smoke comprueba sus estilos computados y la caducidad del tooltip tras cerrar el popup.

### Consulta manual de canción (desde 2.4)

```text
Botón «Obtener título de canción»
  → SongRequestController.request()
  → RuntimePlaybackSongClient.refresh()
  → REFRESH_PLAYBACK_SONG (worker) → REFRESH_SONG (offscreen)
  → PlaybackMetadataController.refreshSong() → SongController.refreshNow()
  → consulta GET_SONG habitual → actualización compartida + SongResponse
```

- Solo se solicita durante Radio 3 en `playing`/`buffering`. El botón aparece al seleccionar Radio 3, desactivado en reposo; se oculta para otras emisoras. No inicia audio, captura ni reconocimiento externo.
- `SongController` comparte un único Promise por revisión entre el sondeo automático y las consultas explícitas concurrentes. Si está esperando el próximo sondeo, lo cancela y consulta ahora; tras la respuesta programa un único sondeo para 15 segundos después. La caducidad mantiene su timer independiente y nunca se amplía por pulsar el botón.
- Los errores siguen limpiando la canción compartida y permiten continuar el sondeo; además se propagan al solicitante manual para distinguir fallo de consulta de respuesta sin identificación reciente. Las llamadas automáticas consumen el rechazo para no generar promesas sin manejar.
- `SongRequestController` depende de `SongRefresher` y `SongRequestView`, no de Chrome/DOM. Gestiona disponibilidad, estado ocupado, doble clic, ausencia de datos recientes y error. Revisiones invalidan el feedback al detener, cambiar emisora o cerrar. Una actualización automática reciente retira avisos de fallo/ausencia anteriores.
- La tarjeta musical sigue recibiendo `METADATA_CHANGED` del propietario offscreen; el controlador del botón no crea otra copia de la canción ni modifica `PlayerState`. Los errores musicales no se muestran como errores de audio.
- El flujo usa los permisos y fuente existentes. Una consulta explícita no obliga al servidor de RTVE a realizar otro reconocimiento; el umbral de 60 segundos y todas las validaciones se conservan.

### Cambiar la interfaz

Mantener los contratos del presentador y reemplazar `PopupView`. No hay motivo actual para añadir React; una interfaz mucho más compleja podría justificarlo sin modificar el núcleo de reproducción.

## Compilación y distribución

`tsc` emite módulos ES2022 en `build/` con sourcemaps. No se utilizan imports de paquetes npm en runtime, alias que requieran resolver en el navegador ni código remoto.

El manifest apunta a `build/entries/background.js`, y los HTML a los entrypoints de popup y player. Los HTML, CSS, logos e iconos permanecen en la raíz y sus carpetas estáticas, para conservar la ubicación instalada por el usuario.

Una única fuente de verdad: `src/`. Se eliminaron los antiguos scripts monolíticos de la raíz. `build/` es generado y no se edita a mano. `package-lock.json` fija las herramientas para instalaciones reproducibles con `npm ci`.

Las pruebas utilizan `node:test` e importan los módulos compilados directamente. Los dobles de puertos permiten probar reglas sin Chrome; pruebas de adaptadores y un smoke opcional en Brave/Chromium real cubren la integración. La audición y validación visual en cada navegador siguen siendo necesarias.
