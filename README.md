# RNE · Radio en directo

Extensión Manifest V3 para Chrome, Brave, Helium y otros navegadores con las APIs de Chromium 116 o posterior. Escucha Radio Nacional, Radio 3, Ràdio 4, Radio Clásica, Radio 5 y Radio Exterior.

**Proyecto independiente, no oficial y sin vinculación con RTVE.** Las emisiones, logos y marcas pertenecen a sus respectivos titulares.

## Instalar o actualizar

La extensión ejecuta JavaScript generado a partir de TypeScript. Los archivos compilados están en `build/`; **se sigue cargando la carpeta raíz `rne-radio`**, no `build/`.

Si ya la tienes instalada y `build/` está generado, solo pulsa **↻ Recargar** en su tarjeta. No necesitas eliminarla ni volver a instalarla. Recargar interrumpe la reproducción. Desde la versión 2.1 se solicita acceso a `https://www.rtve.es/*` para consultar la programación; si el navegador pide confirmarlo, acepta ese permiso para ver los programas. Desde la versión 2.2 se añade `https://nowplaying.rtve.es/*` para consultar canciones de Radio 3.

Para preparar una copia del código fuente, con Node.js 22 o posterior:

```sh
npm ci
npm run build
```

Para instalar por primera vez:

1. Abre `chrome://extensions`, `brave://extensions` o **Gestionar extensiones** en el menú de tu navegador.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona `rne-radio`, donde está `manifest.json`.
4. Fija el icono a la barra. Ábrelo, selecciona una emisora y pulsa reproducir.

No hacen falta Node.js ni `node_modules` para ejecutar una copia ya compilada en el navegador.

## Funciones

- Seis emisoras con sus logos incluidos localmente: abrir el popup no descarga imágenes.
- Reproducción en segundo plano al cerrar el popup, mediante un documento `offscreen`.
- Cambiar de emisora mientras escuchas cambia la señal. En reposo, selecciona sin empezar a reproducir.
- El icono de la barra y su texto emergente cambian con la emisora seleccionada, incluso sin reproducir. Se restaura la última selección al reiniciar. No se superpone la etiqueta «ON»: el logo permanece visible.
- La tarjeta de gestión de extensiones conserva el logo general de RNE.
- **Ahora en antena**: programa actual, presentador (cuando se publica) y horario peninsular para las seis emisoras. Los títulos aparecen también debajo de cada emisora en la lista, sin tener que seleccionarlas. Se consultan al abrir y aproximadamente cada minuto mientras está abierto el popup; al cerrar se detiene el refresco de las filas. Mientras se escucha, offscreen sigue consultando el programa de la emisora seleccionada para el tooltip de la barra. Lista y reproductor comparten los mismos datos; el proveedor del worker comparte consultas concurrentes y caché con offscreen.
- Si RTVE no responde o devuelve datos caducados, aparece «Programación no disponible» en el reproductor y se conserva la descripción habitual en la fila de la emisora, sin afectar al audio. Los títulos largos de la lista se abrevian visualmente y pueden leerse completos al pasar el ratón.
- **Canción de Radio 3**: título y artista sin el rótulo «CANCIÓN IDENTIFICADA», tanto en el popup como en el tooltip mientras se reproduce Radio 3. Se consulta aproximadamente cada 15 segundos. Solo se muestra una identificación de menos de 60 segundos y desaparece antes si la duración restante indica que terminó. Si es antigua, futura, inválida o falla la consulta, no aparece ningún nombre de canción ni aviso de «última canción»; la información del programa se mantiene independiente.
- Desde **2.3.1**, popup y tooltip leen la misma identificación mantenida por offscreen. Cerrar y reabrir el popup recupera el estado vigente sin otra petición a RTVE ni renovación de caducidad. Las canciones nuevas y su retirada se propagan mediante eventos; los snapshots lentos no sobrescriben actualizaciones más recientes. Solo offscreen inicia el sondeo de la fuente musical.
- **Obtener título de canción (2.4)**: botón en Radio 3 para consultar RTVE inmediatamente, sin esperar al sondeo de 15 segundos. Se activa al reproducir o durante una recuperación breve de señal. Si ya hay una petición musical en curso, la comparte; no inicia otro circuito de consultas ni reinicia el audio. Muestra «Consultando…», distingue ausencia de identificación reciente de un error y permite reintentar. Actualiza la misma canción del popup y del tooltip. No analiza ni envía audio, no usa reconocedores externos y no amplía permisos.
- **Tooltip de la barra (2.3)**: muestra emisora, nombre del programa y canción/artista recientes cuando se publican para Radio 3. Se refresca y retira canciones caducadas incluso con el popup cerrado, usando timers en offscreen, no en el worker suspendible. Al detener se queda solo la emisora.
- Reseleccionar la emisora actual no reinicia la señal. Un buffering breve no borra una canción aún vigente. Al volver a Radio 3 se puede recuperar su identificación reciente, siempre con la fecha de caducidad original; nunca se muestra en otra emisora.
- El botón muestra el cuadrado de detener durante reproducción/conexión y el triángulo de play al parar; se alterna el atributo `hidden` de los SVG, no una propiedad inexistente en `SVGElement`.
- Volumen y emisora guardados localmente, sin sincronización con una cuenta.
- Detener libera la conexión; reproducir otra vez conecta al directo, no a audio atrasado.
- Estados de conexión, recuperación de señal y error; controles multimedia del sistema cuando el navegador los permite.
- No inicia sonido automáticamente, ni realiza reintentos indefinidos. Ante un fallo, pulsa reproducir de nuevo.
- El navegador puede destruir el documento offscreen tras unos 30 segundos sin reproducir; se recrea al volver a utilizarlo.

Se seleccionan **emisoras**, no programas a la carta. Se escucha el programa que se esté emitiendo en ese momento. La programación procede de la parrilla de RTVE y puede tener retrasos o cambios de última hora. La canción de Radio 3 procede del recurso de identificación usado por su app: no se analiza el audio en la extensión y no se garantiza sincronía exacta con la señal, que puede tener su propio retardo. El umbral conservador de 60 segundos prioriza no mostrar información antigua, aunque algunas canciones no lleguen a aparecer. Si RTVE no renueva el reconocimiento, el título puede desaparecer aunque la canción siga sonando; cerrar/reabrir no debe ni provocar esa pérdida antes de caducar ni resucitar un dato vencido. No hay identificación musical verificada para otras emisoras ni podcasts.

Las fuentes y sus limitaciones están documentadas en **[docs/now-playing-investigation.md](docs/now-playing-investigation.md)**.

## TypeScript y arquitectura

Se utiliza **TypeScript estricto**, sin framework de interfaz, contenedor de inyección ni librerías de audio. TypeScript se usa solo durante el desarrollo: el navegador recibe módulos JavaScript ES2022 locales, sin scripts remotos ni bundler.

Arquitectura de **puertos y adaptadores**, en una variante pequeña:

```text
src/
├── domain/                  Catálogo, estado, comandos y reglas de validación
├── application/             Casos de uso y contratos (puertos)
│   ├── radio-player.ts      Estado y ciclo de reproducción
│   ├── background-service.ts  Coordinación de ajustes, host e icono
│   ├── popup-controller.ts  Presentador, concurrencia y debounce
│   ├── program-controller.ts  Refresco de programa y descarte de respuestas antiguas
│   ├── station-programs-controller.ts  Comparte programación de lista y selección
│   ├── song-controller.ts  Sondeo y caducidad independiente de identificaciones
│   ├── playback-metadata-controller.ts  Metadatos compartidos ligados al audio
│   ├── song-request-controller.ts  Consulta explícita, disponibilidad y mensajes
│   └── ports.ts             Audio, ajustes, reloj, cliente y vista
├── infrastructure/
│   ├── audio/               Adaptador HTMLAudio, reloj y Media Session
│   ├── chrome/              Mensajes, storage, offscreen e icono de barra
│   └── rtve/                Proveedores de programas y canciones, validación y frescura
├── presentation/            Renderizado y eventos DOM
└── entries/                 Composición e inicio de los tres contextos
```

**El dominio y la aplicación no importan Chrome ni acceden al DOM.** Las implementaciones concretas se proporcionan por constructor. Los tres entrypoints conectan las piezas y registran los listeners de Chrome sin esperar operaciones asíncronas.

Patrones utilizados:

- **Adapter**: encapsula HTMLAudio y las APIs de Chrome.
- **Repository**: separa las preferencias de su almacenamiento.
- **Command**: unión discriminada para las acciones del reproductor.
- **Observer**: el reproductor publica snapshots y las vistas se actualizan.
- **MVP / Presenter**: el controlador del popup no sabe renderizar HTML.
- **Single-flight y colas**: evita documentos offscreen duplicados y escrituras/iconos fuera de orden.

Más detalles, flujos y guía para añadir funciones en **[docs/architecture.md](docs/architecture.md)**.

## Desarrollo

```sh
npm ci                   # Instalar herramientas según package-lock.json
npm run build            # Compilar src/ → build/
npm run watch            # Recompilar al modificar TypeScript
npm run typecheck        # Comprobar tipos sin emitir archivos
npm test                 # Compilar y ejecutar pruebas unitarias/integración simulada
npm run check            # Comprobar tipos + pruebas
npm run test:browser     # Navegador real y programación simulada, incluido fallo HTTP
npm run test:browser -- --live-programs  # También comprobar la programación real de RTVE
npm run icons            # Regenerar los 24 PNG de los seis logos
```

Durante el desarrollo, deja `npm run watch` ejecutándose. Después de cambiar archivos, pulsa **↻ Recargar** en la página de extensiones. La compilación no recarga automáticamente el navegador.

`npm run icons` requiere Chrome, Brave o Chromium instalado. `npm run test:browser` requiere Node.js 22+ y un navegador que acepte cargar extensiones por línea de comandos (Brave o Chromium; Chrome comercial reciente puede ignorar esa opción). Puedes indicar el ejecutable mediante la variable `CHROME_PATH`.

Las dependencias de npm son **solo de desarrollo**: TypeScript y tipos de Chrome. El navegador no carga ningún paquete de npm. `build/` y `node_modules/` se ignoran en Git: al obtener el código fuente hay que compilar antes de cargar la extensión. No edites `build/` a mano.

### Git y revisión

- Repositorio privado: `https://github.com/carlosYoko/rne-radio`.
- `main` es la rama principal de producción; las entregas se revisan mediante pull requests.
- La importación inicial de la versión 2.4.0 está en `feat/initial-extension`, organizada en commits por capas. Es una separación del estado existente, no una reconstrucción del historial previo; los commits intermedios no representan versiones completas de la extensión.
- GitHub Actions ejecuta `npm ci` y `npm run check` con Node.js 22 en cada PR hacia `main` y en los cambios de `main`.
- El smoke de navegador se ejecuta localmente con `npm run test:browser`; no está incluido en CI ni acredita la calidad del sonido.
- Para conservar los commits por capas al integrar esta primera PR, utiliza **Create a merge commit** en lugar de **Squash and merge**.

### Pruebas

Las pruebas importan directamente los módulos compilados, sin eliminar imports ni ejecutar código modificado en una VM. El audio, reloj y almacenamiento se sustituyen por implementaciones simuladas donde corresponde.

Se comprueban reproducción, cambios de emisora, persistencia ordenada, cancelación, errores, mensajes inválidos, respuestas fuera de orden, iconos, separación de capas e integridad de los archivos compilados.

El smoke del navegador carga la extensión real en un perfil temporal, con sonido silenciado: comprueba los seis botones, documento offscreen, selección, aplicación real de los seis iconos mediante `setIcon`, ausencia del badge «ON», título de barra, volumen, PLAY/STOP y persistencia. Comprueba también la programación y el fallback ante un fallo HTTP mediante fixtures. Con fixtures de audio simulado comprueba además tres reaperturas del popup sin perder la identificación vigente ni aumentar las peticiones musicales, canciones sucesivas y recuperación tras respuestas antiguas, futuras y fallos. También comprueba que el tooltip mantiene el programa y retira una canción caducada después de cerrar el popup, y que esta no reaparece al volver a abrir. Verifica mediante estilos computados los iconos visibles de play/stop. También pulsa el botón de consulta manual con respuesta reciente, antigua, futura y error, valida reintentos sin duplicar doble clic y comprueba que no cambia el audio ni la programación. También verifica con fixtures una canción reciente, su retirada por caducidad y la ausencia de canciones antiguas, futuras o con error, sin eliminar el programa. Con `--live-programs` consulta programación y metadatos musicales reales y requiere que los servicios de RTVE estén disponibles; una respuesta musical antigua válida debe dar `null`. No acredita la calidad del audio ni sustituye comprobar los logos visualmente y la reproducción manual en cada navegador.

Prueba manual recomendada:

1. Abrir el popup: no debe sonar sola.
2. Seleccionar cada emisora: deben cambiar logo, título e icono de barra sin iniciar sonido.
3. Reproducir cada señal y comprobar que corresponde con su nombre.
4. Cerrar el popup: debe continuar sonando. Reabrir: debe mostrar el estado actual.
5. Cambiar de emisora durante la reproducción: solo debe sonar una.
6. Cambiar volumen, detener, esperar 35 segundos y reabrir: los ajustes deben mantenerse.
7. Desconectar la red y reintentar tras recuperarla: no debe quedarse bloqueada.
8. Reiniciar navegador o recargar extensión: conserva emisora y logo, sin reproducir automáticamente.
9. Comprobar programa, presentador y hora al cambiar emisora. Dejar el popup abierto hasta el siguiente programa y verificar el refresco. Si se bloquea RTVE o se desconecta la red, la programación debe fallar sin bloquear los controles de audio.

10. Reproducir Radio 3: si RTVE publica una identificación reciente, aparece canción y artista. Si devuelve una antigua o falla la consulta, no debe aparecer información musical. Cambiar de emisora o detener debe ocultarla inmediatamente, sin quitar el programa del popup. Cerrar el popup y pasar el ratón por el icono: mientras se escucha, el tooltip debe mostrar programa y canción recientes; al caducar la canción desaparece de allí también.
11. Pulsar de nuevo la misma emisora no debe reconectar ni ocultar la canción. Comprobar que el botón muestra stop mientras reproduce y play tras detener.
12. Mientras se muestra una canción vigente, cerrar y reabrir varias veces: debe recuperarse sin reiniciar su plazo. Si caduca con el popup cerrado, no debe reaparecer al abrir; una identificación nueva debe mostrarse sin tener que detener la radio.
13. Seleccionar Radio 3: «Obtener título de canción» debe estar desactivado hasta reproducir. Pulsarlo durante la reproducción: consulta inmediata, con botón ocupado. Si RTVE no ofrece datos recientes, muestra ese aviso sin título antiguo; si falla la consulta, permite reintentar. No deben cambiar audio ni programa. Cambiar de emisora durante la petición no debe mostrar después el resultado o aviso de Radio 3 en la nueva emisora.

## Permisos y privacidad

- `offscreen`: mantener el reproductor fuera del popup.
- `storage`: recordar emisora y volumen. Solo el service worker accede a esta API, porque offscreen solo dispone de `chrome.runtime`.
- `https://www.rtve.es/*`: permiso de host para consultar la parrilla desde el worker. Solo se solicitan los recursos `servicios/programasRadio/R1.json` a `R6.json`, sin cookies ni envío de preferencias. RTVE recibe los datos normales de la conexión, incluida tu IP.
- `https://nowplaying.rtve.es/*`: consultar únicamente `radio3.json` mientras Radio 3 reproduce, incluido con el popup cerrado para mantener el tooltip. Durante un buffering breve continúa el refresco; al detener o fallar la señal se cancela. No se envían cookies, audio ni preferencias; RTVE recibe los datos normales de conexión, incluida tu IP. No se descargan portadas ni se contacta con Spotify, Deezer u otros servicios citados en la respuesta.
- No accede a pestañas, historial ni micrófono, ni inyecta scripts en páginas web.
- Sin analítica, anuncios ni código remoto.
- Al reproducir se contacta con `dispatcher.rndfnk.com` y los servidores de audio a los que redirige. Esos proveedores reciben los datos normales de una conexión, incluida tu IP.

La reproducción MP3 utiliza el elemento nativo de audio, no `fetch`, y no requiere permisos de host para el audio. Los permisos de host de RTVE se utilizan exclusivamente para consultar programación e identificaciones musicales. Se conservan las URLs del distribuidor, no sus redirecciones con tokens temporales. La disponibilidad, cambios de URL y restricciones geográficas dependen del proveedor.

## Distribuir

Ejecuta `npm ci`, `npm run check` y `npm run build`. El ZIP de ejecución debe tener `manifest.json` en su raíz e incluir:

- `manifest.json`, `popup.html`, `popup.css`, `offscreen.html`.
- `build/`, `icons/` y `assets/`.

No necesitas incluir `node_modules/`, `src/`, `tests/`, `tools/`, `docs/`, configuraciones de desarrollo ni archivos npm. No ejecutes este ZIP como código fuente de desarrollo.

Cada tienda requiere revisión, ficha y declaraciones de privacidad. Comprueba las condiciones de uso de los logos y marcas de RTVE y obtén autorización cuando corresponda; su inclusión no implica autorización ni aval oficial. Consulta también `assets/logos/README.md`. Esta extensión no está publicada ni firmada por una tienda.
