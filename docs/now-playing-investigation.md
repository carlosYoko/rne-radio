# Investigación: canción y artista en directo

## Conclusión

**Actualización tras investigar la app Android: sí se ha localizado un recurso de RTVE con canción, artista y álbum de Radio 3: <https://nowplaying.rtve.es/radio3.json>.** La configuración pública de la aplicación lo referencia como `identificadorCanciones`. La respuesta HTTP 200 se ha comprobado sin autenticación.

**Precaución:** el recurso puede conservar una identificación antigua. En la muestra observada, la fecha del resultado llevaba unos diez minutos de retraso; no debe presentarse automáticamente como la canción que está sonando. Véase la sección 4.

También se ha verificado una fuente de **programa actual**, presentador y horario para las seis emisoras. Las conclusiones iniciales sobre la ausencia de títulos solo se referían al MP3, la parrilla y la ficha del directo; no a este nuevo recurso.

En la investigación inicial no se modificaron funciones ni permisos. **Actualización en la versión 2.1:** se ha integrado la información del programa actual en el popup, con presentador y horario peninsular. Los títulos se muestran también en las seis filas de emisoras, con consultas al abrir y refresco aproximado cada minuto mientras esté abierto. Se añadió el permiso de consulta a `www.rtve.es`. **Actualización en la versión 2.2:** se integra la identificación de Radio 3 con validación temporal estricta, según se detalla más abajo; nunca se muestra una identificación caducada.

## 1. Metadatos ICY de la señal MP3

Se solicitó la señal del distribuidor con la cabecera:

```http
Icy-MetaData: 1
```

URLs estables comprobadas:

- `https://dispatcher.rndfnk.com/crtve/rner3/main/mp3/high`
- `https://dispatcher.rndfnk.com/crtve/rnerc/main/mp3/high`

Las dos respondieron HTTP 200 con `content-type: audio/mpeg`, bitrate 128 e `icy-metaint: 16384`. Este último indica que el protocolo incluye un bloque de longitud de metadatos tras cada 16 384 bytes de audio, no que exista un título musical.

### Muestra observada

Periodo: **15 de octubre de 2026, aproximadamente 20:12–20:13 UTC**. Se abrieron conexiones de observación de 60 segundos en paralelo, independientes del reproductor.

| Emisora | Bytes recibidos | Intervalos ICY completos | Paquetes con contenido |
| --- | ---: | ---: | ---: |
| Radio 3 | 1 032 847 | 63 | 1 |
| Radio Clásica | 1 030 158 | 62 | 1 |

El único contenido no vacío de ambas conexiones fue:

```text
StreamTitle='';json='{}';
```

Los demás intervalos no añadieron información. Por tanto, **durante esa muestra no se recibió canción ni artista**. Una muestra previa de 20 segundos de Radio 3 produjo el mismo contenido.

`icy-name` identifica la emisora; no identifica la canción. No se deben presentar estos campos como metadatos musicales.

### Repetir la comprobación

Con Node.js 22+ y `build/` generado:

```sh
npm run build
node tools/probe-radio-metadata.mjs rner3 60
node tools/probe-radio-metadata.mjs rner3,rnerc 60
```

El script admite los IDs del catálogo y entre 5 y 120 segundos. Imprime un informe JSON, cancela las conexiones al finalizar y no guarda audio, preferencias ni URLs de redirección con tokens. Es una herramienta manual de investigación, no una tarea del reproductor ni una prueba automática habitual.

Leer ICY desde la extensión exigiría una integración adicional: `HTMLAudioElement` no expone `StreamTitle` de MP3 como una propiedad. Abrir otra conexión solo para leer metadatos consumiría ancho de banda y requeriría revisar permisos/redirecciones, sin resolver la ausencia actual de títulos.

## 2. Fuente oficial de programas

La propia web y el reproductor de RTVE utilizan este recurso:

<https://www.rtve.es/servicios/programasRadio/R3.json?emision=ahora-sig>

Estructura observada:

```text
emisiones[]
  id
  programas.items[]
    nombre
    presentador
    hora
    horaFin
    isNow
    url
    imagen
    fechaInicio
```

El elemento marcado con `isNow: true` identifica el programa que la parrilla considera actual. Se verificaron HTTP 200 y un programa actual para las seis emisoras:

| ID de la extensión | Recurso de RTVE | Programa observado durante la investigación |
| --- | --- | --- |
| `rne1` | `R1.json?emision=ahora-sig` | 24 horas |
| `rnerc` | `R2.json?emision=ahora-sig` | Músicas con alma |
| `rner3` | `R3.json?emision=ahora-sig` | El sótano |
| `rner4` | `R4.json?emision=ahora-sig` | Sota sospita |
| `rne5` | `R5.json?emision=ahora-sig` | 24 horas |
| `rneree` | `R6.json?emision=ahora-sig` | Gitanos |

Por ejemplo, Radio 3 devolvió **El sótano**, presentado por **Diego RJ**, de **22:00 a 23:00** según los campos del servicio. Eso es **programa y presentador**, no **canción y artista**. No se observaron campos de canción actual en esos elementos.

Se confirmó su uso en el código público de la web:

- Página: <https://www.rtve.es/play/radio/radio-3/>
- Reproductor: <https://js2.rtve.es/player/pf_audio.js>
- En ese reproductor, el catálogo de canales referencia `programasRadio/R1.json` hasta `R6.json`, y los métodos del directo consultan esos feeds para la información mostrada.

Este recurso es accesible públicamente y fue verificado, pero no se ha establecido que sea una API pública con contrato de estabilidad. Debe encapsularse como un proveedor sustituible y tolerar campos ausentes, cambios de esquema, retrasos o cambios de parrilla.

## 3. Ficha del directo y cuepoints

Recursos adicionales comprobados:

- <https://www.rtve.es/api/audios/1712469.json>
- <https://www.rtve.es/api/audios/1712469/cuepoints.json>

La ficha del directo devuelve `title: "Radio 3 en directo"`, `consumption: "live"` y `programInfo: null`. No es un título de canción.

Los cuepoints devolvieron:

```json
{"items":[]}
```

Tampoco se obtuvo de ahí una lista de canciones actuales.

## 4. Fuente localizada a partir de la aplicación Android

### Identificación y procedencia

- App oficial: [Radio 3, de RTVE Medios Interactivos, en Google Play](https://play.google.com/store/apps/details?id=com.rtve.radio3&hl=es), paquete `com.rtve.radio3`.
- La propia descripción de Google Play anuncia: «tema y artista en pantalla mientras escuchas el directo».
- Se realizó una inspección estática de una copia 3.0.0 obtenida de un distribuidor externo; no se instaló ni ejecutó el APK y no se comprobó que fuera el mismo binario instalado por el usuario. Sus cadenas referencian una configuración que se verificó directamente en el dominio oficial de RTVE.
- No se accedió al teléfono del usuario, sus cuentas, credenciales ni tráfico privado.

Configuración pública verificada:

<https://www.rtve.es/m/configs/radio3/2026/estructura.json>

Fragmento de `radioPrincipal`:

```json
{
  "radioCode": "R3",
  "identificadorCanciones": "https://nowplaying.rtve.es/radio3.json"
}
```

La configuración está versionada por ruta; no se presupone que esa ubicación permanezca igual para todas las versiones de la app.

### Respuesta del servicio

<https://nowplaying.rtve.es/radio3.json> devolvió HTTP 200, `Content-Type: application/json`, `Cache-Control: max-age=2` y `Access-Control-Allow-Origin: *`, sin claves ni inicio de sesión en la petición de comprobación.

Campos musicales relevantes del ejemplo recibido:

```json
{
  "metadata": {
    "timestamp_utc": "2026-10-15 20:26:25",
    "music": [{
      "title": "Cuervos",
      "artists": [{ "name": "Oscar Avendaño & Reposado" }],
      "album": { "name": "El huevo de la serpiente" },
      "duration_ms": 254000,
      "play_offset_ms": 152920,
      "score": 100
    }],
    "type": "realtime"
  },
  "status": { "code": 0, "msg": "Success" }
}
```

El array `music` también contenía un elemento separado con `URLimagen`, sin título: **no se debe asumir que todos sus elementos representan canciones**. La respuesta completa incluye identificadores y enlaces de servicios musicales externos, pero no es necesario usarlos para mostrar título y artista.

### Comprobación de antigüedad

Tres consultas adicionales, separadas por 15 segundos, observaron:

| Fecha de consulta UTC | `metadata.timestamp_utc` | Última modificación HTTP |
| --- | --- | --- |
| 2026-10-15 20:36:19 | 2026-10-15 20:26:25 | 20:26:31 |
| 2026-10-15 20:36:34 | 2026-10-15 20:26:25 | 20:26:31 |
| 2026-10-15 20:36:49 | 2026-10-15 20:26:25 | 20:26:31 |

Se solicitó evitar caché. El encabezado HTTP `Date` avanzaba, pero el timestamp del contenido no. El último dato recibido no acredita que «Cuervos» continuara sonando; podría conservarse el último reconocimiento durante voz, ausencia de identificaciones nuevas o una interrupción del proveedor. **La causa no se ha determinado.** La etiqueta `type: realtime` y un `score` alto tampoco garantizan frescura.

### Integración en la extensión (2.2)

- Encapsular el recurso en un adaptador específico de metadatos de Radio 3, independiente de audio y parrilla.
- Consultarlo con frecuencia moderada —por ejemplo, cada 15 segundos solo cuando se necesite mostrarlo—, con timeout y sin duplicar peticiones.
- Validar `status`, el esquema, artistas, título y timestamp UTC; aceptar listas vacías y elementos sin título.
- Se usa la fecha UTC del contenido, no la fecha HTTP ni la descarga, con un máximo conservador de **60 segundos**, excluyendo el límite y fechas futuras o inválidas. Es un umbral de seguridad, no una garantía de sincronización; su cobertura requiere observar más programas.
- Considerar duración y posición como información auxiliar para no prolongar una canción que probablemente terminó; esos campos tampoco prueban sincronización exacta con el MP3 del navegador.
- **Decisión del usuario: si el dato es antiguo, no mostrar ni título ni artista.** Tampoco se conserva como «Última canción identificada». La información del programa permanece independiente.
- Mantener el programa actual como fallback y no bloquear el audio si el recurso falla.
- Revisar acceso al nuevo host y actualizar privacidad al integrarlo. La cabecera CORS observada permite acceso entre orígenes, pero no constituye un contrato de estabilidad.
- No descargar automáticamente carátulas de terceros ni enviar audio de la extensión a un reconocedor: para leer este recurso no hace falta ninguna de esas acciones.

Implementado en `RtveSongProvider` y `SongController`, mediante el puerto `SongProvider` y el mensaje `GET_SONG`. Desde 2.3 también se mantiene el tooltip desde offscreen, con el popup cerrado. Se consulta mientras Radio 3 está en estado `playing` o `buffering`, aproximadamente 15 segundos después de cada respuesta, con timeout de 5 segundos y peticiones concurrentes compartidas. Un temporizador independiente oculta la canción al vencer, incluso durante una consulta pendiente. La duración y posición, cuando se publican, pueden adelantar la caducidad. Al detener, cambiar emisora o fallar la señal se limpia la vista y se ignoran respuestas tardías. Desde 2.3.1, solo offscreen inicia las consultas musicales a RTVE: el popup lee su snapshot vigente y escucha `METADATA_CHANGED`. Cerrar y reabrir no vuelve a consultar la fuente ni renueva la fecha; una lectura pendiente no puede borrar un evento más reciente. Un buffering breve no borra una identificación vigente; al volver a Radio 3 puede recuperarse mientras no haya vencido, sin renovar su caducidad. Se revalida también al recuperar foco o visibilidad. El manifest añade el host `nowplaying.rtve.es` y el README describe su uso y privacidad. No se descarga ninguna portada ni se envía audio.

Desde **2.4**, el botón «Obtener título de canción» permite adelantar la consulta a esta misma fuente mientras se escucha Radio 3. Reutiliza el controlador y las peticiones en curso de offscreen, conserva caducidad y comunica ausencia de datos recientes o error. No fuerza otro reconocimiento en el servidor y no analiza ni envía audio a terceros.

### Comprobación al investigar reaperturas (2.3.1)

En una consulta manual del **15 de octubre de 2026 a las 21:06:40 UTC**, el servicio respondió HTTP 200 con `timestamp_utc: 2026-10-15 21:01:46`, título «Élan - Live», artista Nightwish, duración 267000 ms y posición 8060 ms. La identificación llevaba casi cinco minutos sin actualizarse y ya no era válida. Es un ejemplo adicional de ausencia de frescura en la fuente, independiente del ciclo de vida del popup. La corrección de estado compartido no amplía el umbral de 60 segundos ni atribuye todos los síntomas de ausencia de título a la interfaz.

## Recomendación de implementación

### Primera opción: información del programa

Es la mejora respaldada por los datos verificados:

```text
Radio 3
El sótano
Diego RJ · 22:00–23:00
```

- Añadir un puerto de consulta de programación y un adaptador de RTVE.
- Mantener esa información separada del estado autoritativo del audio.
- Consultar al seleccionar emisora y actualizar con una frecuencia moderada, por ejemplo un minuto.
- Cancelar o ignorar respuestas de una emisora anterior y descartar datos caducados.
- Ante un fallo, mostrar «Escuchando en directo», sin bloquear la radio.
- Añadir el permiso de host de RTVE para las consultas desde la extensión y actualizar la información de privacidad.
- No confiar en un `setInterval` permanente dentro del service worker, que puede suspenderse. El refresco debe diseñarse según si se necesita solo con el popup abierto o también en segundo plano.

### Segunda opción: reconocer una canción

Tras integrar el recurso musical de RTVE con ocultación de datos caducados, conviene seguir evaluando su disponibilidad y frescura. Un servicio de reconocimiento independiente solo sería una alternativa si se desea identificar canciones que ese recurso no cubre.

Un botón explícito «Identificar canción» permitiría hacerlo bajo demanda, pero habría que evaluar proveedor, precio, permisos, envío de un fragmento de audio y manejo de claves. No se debería incluir una clave de servicio compartida y secreta dentro de una extensión distribuida. El reconocimiento puede fallar con voz superpuesta, actuaciones en directo o temas no incluidos en el catálogo.

No se ha contratado ni integrado ningún servicio externo. No se ha enviado audio a un servicio de reconocimiento.
