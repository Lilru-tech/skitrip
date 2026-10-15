# Validación

## Estado al 15/10/2026 (corrección tras revisar la fase 2)

Cuatro tipos de comprobación, separados. Una captura de octubre **no** valida el formato de invierno.

| Tipo | Qué | Resultado |
|---|---|---|
| Tests locales | `tsc`, Vitest (Workers pool, D1 local), actionlint de los workflows | ✔ ver la PR |
| Tests remotos | «v2 · CI» de la PR (las mismas pruebas en GitHub) | ver la PR |
| Captura real de fuentes desde la rama | v2-online-check 38704049207 | ✔ FGC 5 de 5 (La Molina, Vall de Núria, Espot, Port Ainé, Boí Taüll): fuera de temporada confirmado. Esquiades 18 de 18 estaciones con fila (85 filas en la página); Alp 2500 y Formigal-Panticosa sin fila conjunta, marcadas no soportadas |
| CPU en producción, antes | v2-cpu-probe 38704461036 | 241 peticiones, 0 cortadas; calendario con 16 personas por encima de 10 ms (ver `QUOTAS.md`) |
| Publicación | v2-release 38711486050 (PR #10) | ✔ pruebas, API (migraciones 0013 y 0014) y Pages |
| Ingesta real de nieve | v2-snow 38712647103 | 29 fuentes: 28 válidas, 0 fallidas, 1 «no soportada» (Port del Comte oficial: ver abajo); 28 filas escritas |
| Fuentes online, publicado | v2-online-check 38712651823 | ✔ FGC 5 de 5 (fuera de temporada confirmado), Esquiades 18 de 18, ofertas 17 con datos + 2 fuera de temporada, nieve oficial con datos salvo Port del Comte |
| CPU después | v2-cpu-probe 38713197532 y 38714990287 | 258 y 261 peticiones, 0 cortadas; ver `QUOTAS.md` (antes/después y lo que sigue por encima de 10 ms) |
| Vigilancia con estado | v2-watch 38714993409 | ✔ 0 fallos, 0 degradaciones, 7 avisos aislados, 0 errores de los mecanismos; estado guardado en `watch_findings` |
| Catálogo y lecturas (PR #12) | v2-cpu-probe acotado 38732558754 (antes) y 38738050166 (después), release 38736977323 | catálogo p50 17 → 2 ms (24 peticiones cada vez); viaje con 16 personas sin resolver (p50 ~10 ms); filas por carga del catálogo 30.090 → 358 en local. Ver `QUOTAS.md` |
| Ofertas de Baqueira y Port del Comte | captura programada v2-offers 38737663168 y vigilancia 38738977781 | ✔ 17 páginas con ofertas y 2 «sin ofertas confirmado»: Baqueira y Port del Comte vuelven a «fuera de temporada (pendiente de invierno)», sin precios |
| Invierno | primera apertura de las estaciones | pendiente: los casos de invierno de los tests son sintéticos y están marcados así |

### Nieve: qué falló y qué se corrigió

- **La Molina** (fgc-pirineu365, en error desde la captura del 12/10, run 38270429136). Fuera de temporada, `/stations/15/status` devuelve `station_name` vacío y la comprobación estricta de identidad lo rechazaba, correctamente. `/stations/{n}/report` sí da el nombre (captura real del 15/10). Las cinco estaciones FGC prioritarias usan `/report` y mantienen la comprobación estricta: nombre vacío o ajeno → error de identidad, nunca cifras. Los números 21–23 responden 404. robots.txt de la API lo permite todo.
- **Port Ainé y Boí Taüll**: ahora tienen adaptador FGC (estaciones 19 y 20, identificadas por nombre en `/report`). Vallter (17) también responde, pero no hay área de Vallter en el catálogo, así que no se añade.
- **Esquiades** (20 fuentes con 5 fallos seguidos en la vigilancia del 14/10, run 38581604252). La comprobación decía «incompatible» y el recolector guardaba «vacío». Causa real: la fecha «Última nevada 08/10/2026» se contaba como un par «x / y» y descartaba todas las filas. El lector reconoce ahora estado, km y pistas totales y la fecha de cada bloque («Última actualización del …»). La Molina y Masella, y Formigal y Panticosa, salen por separado: las áreas combinadas Alp 2500 y Formigal-Panticosa no tienen fila y sumar estaciones sería inventar el dominio, así que quedan no soportadas en Esquiades y usan su fuente oficial.
- **Motivos comunes** (`src/core/snow-outcome.ts`), los mismos en recolector, comprobación online, ingesta, Administración y vista pública: fuera de temporada, sin parte publicado, estación no incluida, formato no reconocido, identidad ajena, transporte y bloqueo. Fuera de temporada y sin parte publicado no suman fallos seguidos; el resto sí. Un resultado vacío nunca deja una captura como correcta.
- **Pruebas con capturas reales saneadas** (`test/fixtures/real/*.2026-10-15.*`): nombre vacío, nombre ajeno (Vallter en lugar de Boí Taüll, La Molina en lugar de Port Ainé), cierre estacional (`is_winter` activo pero estación inactiva), 404 y la página de Esquiades. El caso de invierno sigue siendo sintético.

### Cobertura de nieve por estación prioritaria (cerca de Tarragona)

| Estación | Fuente oficial | Fila de Esquiades | Hasta invierno |
|---|---|---|---|
| La Molina, Vall de Núria, Espot, Port Ainé, Boí Taüll | API de FGC (`/report`) | sí | fuera de temporada confirmado; formato de invierno sin validar |
| Masella | no publica parte oficial | sí | solo Esquiades |
| Port del Comte | web oficial | sí | |
| Grandvalira, Ordino Arcalís, Pal Arinsal | web oficial | sí | Ordino y Pal no publican km |
| Cerler, Formigal-Panticosa | Aramón | Cerler sí; Formigal y Panticosa por separado | |
| Baqueira-Beret | baqueira.es responde 403 y no se elude | sí | solo Esquiades |
| Ax 3 Domaines, Font-Romeu | sin adaptador (Ax solo publica un mapa) | sí | solo Esquiades |

**Errores observados tras publicar (15/10/2026):**
- **Port del Comte oficial** quedó «robots.txt no lo permite» en la ingesta y en la comprobación. Cinco minutos después, el sondeo (v2-online-check 38713288532) leyó su robots.txt, que permite `/pistes/`. Causa: un 5xx o un error de red al pedir robots.txt se trataba como «prohibido» y la fuente quedaba «no soportada», que la vigilancia muestra como limitación documentada. Eso ocultaba que una fuente que funcionaba el 03/10 había fallado. Corregido después: robots.txt no disponible = fallo de transporte, con un reintento.
- **Vigilancia:** Ax y Font-Romeu oficiales (sin adaptador) salían como «sin ningún intento» y se habrían degradado al 3.er día. Corregido: sin adaptador = limitación documentada.
- **Motivos de ofertas:** la migración 0013 rehízo la columna de motivos, así que Baqueira y Port del Comte (ofertas) salen «nunca ha dado datos» hasta la siguiente captura de ofertas, que vuelve a guardar «fuera de temporada».
- **Filas leídas de D1:** 1,27 M en 24 h por las mediciones de hoy (aviso aislado; el límite es 5 M).

El recolector antiguo (`update-data.yml`) sigue desactivado: v2 cubre sus páginas y no hay una necesidad concreta para reactivarlo.

## Historial: estado en producción (03/10/2026)

SkiTrip v2 está publicado en https://lilru-tech.github.io/skitrip/ (Pages desde Actions) con la API en https://skitrip.cold-fire-2451.workers.dev. Todo lo de esta sección se ejecutó en GitHub Actions contra los servicios reales; un workflow omitido por falta de secretos no cuenta.

| Comprobación | Ejecución | Resultado |
|---|---|---|
| Publicación unificada (pruebas → API → Pages) de las PRs 6, 7 y 8 | v2-release 37138388054 | ✔ |
| Humo en producción con cuentas de prueba (a, b, c) | v2-prod-check 37133307031, 37133422887 | ✔ perfiles 4 → 7 → 4, administradores 1 |
| Limpieza de restos de pruebas anteriores por UID exacto | v2-prod-cleanup 37136211279 | ✔ perfiles 4 → 1 (solo la cuenta de David) |
| Recorrido completo (humo + calendario compartido d, e, f) | v2-prod-check 37138923075 | Humo ✔; calendario ✘ (la selección se perdía al repintar). Limpieza 1 → 4 → 1 igualmente |
| Calendario compartido con la prueba corregida | v2-prod-check 37139560555 (rama ops/cpu-followup) | ✔ amistad, viaje, propuesta, revocación y acceso ajeno; limpieza 1 → 4 → 1, administradores 1 |
| Publicación de la PR 9 | v2-release 37142709937 | ✔ |
| Recorrido completo ×2 tras publicar (humo a, b, c + calendario d, e, f) | v2-prod-check 37143243163, 37143448361 | ✔ los 4 trabajos; en cada uno perfiles 1 → 4 → 1, administradores 1, restos 0 |
| Comprobación online de fuentes | v2-online-check 37143244629 | ✔ ofertas 17 con datos, 2 fuera de temporada; nieve oficial 9 con datos; agregador de nieve de Esquiades 20 «incompatible» |
| CPU después de optimizar | v2-cpu-probe 37143655755 | 206 peticiones, 0 cortadas; ver `QUOTAS.md` |
| Copia de seguridad restaurada en una copia de solo lectura | v2-recovery-check 37126210933 | ✔ 57 tablas, 9 hashes heredados |
| CPU por ruta (ver `QUOTAS.md`) | v2-cpu-probe 37136969820 | antes de optimizar: p99 de ofertas 31 ms y común 18,5 ms; 0 exceededCpu en 24 h |

Reglas de las pruebas en producción: solo cuentas dedicadas con alias y correo identificables; la limpieza borra por los UID e IDs exactos que registra la propia ejecución, comprueba que cada fila pertenece a esas cuentas y no toca a David ni a ningún administrador (`tools/prod-cleanup*.ts`). No hay endpoint de limpieza público. La disponibilidad de David no se modifica y no se invita a usuarios reales.

### Fuentes (03/10/2026)

- **Ofertas:** 17 páginas correctas y 795 filas «desde», incluidas las de Esquiades. Baqueira y Port del Comte en Estiber: sin tarjetas, clasificadas «fuera de temporada» con capturas reales (`page-outcome.test.ts`). Un cero nunca cuenta como éxito: se distingue sin ofertas confirmado, fuera de temporada, bloqueo, robots y formato desconocido.
- **Nieve oficial:** La Molina, Vall de Núria y Espot desde la API pública de Pirineu365 (FGC), además de las fuentes de Andorra, Aramón y Port del Comte. Fuera de temporada se guarda «fuera de temporada» con los números vacíos. **Ninguna página de octubre valida el formato de invierno**: los casos de invierno son sintéticos y están marcados así.
- **Limitaciones:** el agregador de nieve de Esquiades no se reconoce (formato desconocido; ya no se confunde con «sin datos»). Port Ainé, Boí Taüll y Vallter no tienen nombre en la API fuera de temporada, así que no hay adaptador todavía. Masella no publica datos oficiales. baqueira.es responde 403 y no se elude.
- **update-data.yml:** sus 19 páginas de ofertas son las mismas que lee v2 y el parte de Esquiades también, así que v2 lo cubre. Desactivado el 03/10/2026 (estado `disabled_manually`), sin borrarlo: se puede reactivar desde Actions. Ya no hace commits de datos que lanzaban v2-release.

## Validación local anterior (01/10/2026)

Fecha: 01/10/2026. Rama `rebuild/v2`, commit c66957a. Todo lo que figura aquí se ha ejecutado en el entorno de desarrollo, que no tiene cuentas de Cloudflare ni Firebase ni permiso de push. Sus scripts no salen a las webs de estaciones y proveedores; esas webs se han leído con una herramienta de lectura web, que devuelve texto y no el HTML crudo.

En aquella fecha SkiTrip v2 aún no estaba publicado. Faltan los accesos de `ACCESOS.md`. Ningún workflow se ha ejecutado en GitHub, y uno omitido no cuenta como probado.

Categorías:

- **Probado (local):** un test automático pasa contra D1 local (workerd), el emulador oficial de Firebase Auth o fixtures.
- **Contrastado con la fuente real:** comprobado, con fecha, contra la web o API real mediante la herramienta de lectura web.
- **Pendiente online:** necesita ejecutarse contra el servicio real desde Actions.
- **Pendiente de David:** necesita accesos, exportaciones o su decisión.
- **No soportado por la fuente:** la fuente no lo publica o no lo permite. No se inventa ni se elude.

## Resultados (copia limpia del commit c66957a)

Condiciones: `git clone` de la rama en un directorio nuevo sin `.dev.vars`, `npm ci`, `CI=1` y sin servidores previos.

| Suite | Resultado |
|---|---|
| Typecheck (`tsc`) | ✔ |
| Vitest: lógica; parsers con fixtures reales y sintéticos; detector de bloqueo; Worker + D1 (auth, permisos, CORS de Pages, cuotas de las 109 rutas, importación de la hoja) | ✔ 318/318 (30 ficheros) |
| Workflows (`npm run test:workflows`): ejecuta los pasos reales con `bash -eo pipefail`, el orden pruebas → API → Pages del mismo SHA y el alcance por archivos | ✔ 7/7 |
| Build de Pages con configuración de marcador + `verify-pages-artifact.sh` | ✔ 8 archivos |
| Playwright: 31 recorridos × 360, 390 y 1280 px, más el recolector local de Estiber (una vez) | ✔ 94 superados, 2 omitidos a propósito (el recolector no depende del tamaño de pantalla) |

## Correcciones de la revisión del 01/10/2026 (sobre 24d1dec)

| Fallo | Prueba que fallaba en 24d1dec | Resultado ahora |
|---|---|---|
| Estiber: el detector tomaba el script de reCAPTCHA por un bloqueo | `looksBlocked(200, página con contenido + script recaptcha__es.js)` → `true` | `false`. Un desafío real (título «Just a moment», formulario de desafío, CAPTCHA sin contenido, DataDome) y los 403/429 siguen parando. `test/core/blocked.test.ts` |
| Estiber: 0 tarjetas con `carousel-cell cl-offer-box cl-offer-box-type-hotel` | `parseOfferCardsHtml(fixture, 'estiber')` → 0 | 2 tarjetas: nombre, fechas, 4 noches, forfait 3 días, 684 € y 421 € por persona; textos pegados, valoración «8.5 (21)» fuera del nombre y del precio; precio rebajado sin mezclar tarjetas vecinas. Recolector completo contra un servidor local con robots.txt (`collector-local.spec.ts`) |
| Nieve: `pair` sin agrupar alternativas | Aramón `Km esquiables 50 / 100 Pistas abiertas 20 / 40 Remontes abiertos 10 / 20` → nulos y `unknown` | 50/100 km, 20/40 pistas y 10/20 remontes, `partial` |
| Nieve: km con decimales | `parseAndorra('Km esquiables 12,5 / 215 …')` y `12.5` → km nulos | 12,5/215. Pistas y remontes solo enteros; abierto > total, total 0 o fuera de límites → nulo. Casos sintéticos de parcial, completo, cerrado, sin datos y parte antiguo |
| Workflows sin pipefail | Paso de verificación con artefacto sin CSP bajo `bash -e` → sale 0. Marcador de Time Travel con wrangler fallando → sale 0 | Todos con `shell: bash` (`-eo pipefail`). Sin CSP, con un CSV o con otro origen: falla antes de subir el artefacto; válido: pasa. Sin marcador no se migra. `tools/workflows.test.mjs` |
| Publicación sin atar a las pruebas | CI, Pages y API se lanzaban por separado | `v2-release.yml`: pruebas del SHA → API (marcador, migraciones, importación, Worker, comprobación en vivo) → Pages. Lo manual pasa por lo mismo y solo desde main. Sin `pull_request_target`. El alcance incluye package.json, lockfile, catálogo, importador, wrangler.jsonc, deploy-config e históricos |

**Limitación de Estiber:** este entorno no llega a estiber.com (el proxy rechaza la conexión). El fixture `estiber-la-molina.reconstruido.html` usa las clases indicadas por la revisión y los textos leídos el 01/10/2026 con una herramienta de lectura web; **no es una captura del HTML**. La captura real saneada se obtiene con «v2 · comprobar fuentes online» y la opción «fixtures»; hasta entonces, la fuente sigue «sin verificar».

Todos los recorridos de navegador y los tests los escribí y ejecuté yo (Claude) en este entorno. No son verificaciones del revisor ni pruebas con lector de pantalla.

## Requisitos del 01/10/2026

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | Publicar en `lilru-tech.github.io/skitrip` sin redirección | Preparado, **sin publicar** | `v2-release.yml` publica Pages solo si la fuente es «GitHub Actions», después de las pruebas y la API del mismo commit. Pendiente de David. |
| 3.1–3.3 | Base `/skitrip/`, rutas con fragmento, `VITE_API_BASE_URL` validado | Probado (local) | `pages-build.spec.ts`: enlace directo, recarga, atrás/adelante, otra pestaña e invitación `#/unirse` |
| 3.4 | CORS exacto, sin comodines, auth obligatoria | Probado (local) | `pages-cors.test.ts`: preflight, Authorization, JSON, escrituras, errores 401/404/422 y orígenes parecidos rechazados. Además, comprobación en vivo en la etapa API de `v2-release.yml`. |
| 3.5 | Firebase real: persistencia, alta, salida, restablecimiento | Probado con el emulador; **con Firebase real, pendiente** | El build rechaza el emulador y los proyectos `demo-`. `resetPassword` vuelve a `/skitrip/#/entrar`. |
| 3.6 | CSP y cabeceras en Pages | CSP en meta probada, sin violaciones (también con pdf.js) | Lo que un meta no puede aplicar está en `DEPLOY.md`. Las cabeceras reales las anota el workflow tras publicar: **aún sin medir**. |
| 3.7 | Workflow de Pages con permisos mínimos | Escrito y probado en local (`npm run test:workflows`); **sin ejecutar en GitHub** | `pages: read` para compilar; `pages: write` e `id-token` solo en el job de publicación |
| 4 | Hoteles por fechas y ocupación | **No soportado por la fuente** | Comprobado el 01/10/2026: el robots.txt de Esquiades prohíbe `/book/` y `/*/hotel/offer/load`, y el de Estiber prohíbe `/csp/online/`. Alternativa aceptada: catálogo orientativo y cotización manual. |
| 4b | Colector de catálogo mejorado | Probado (local) y contrastado | Precio leído en cada tarjeta. El precio rebajado de Estiber, que no viene tachado, se acepta solo si cuadra con el descuento. robots.txt según RFC 9309, también en las peticiones que hace la página. De las 19 páginas revisadas, 10 de Estiber tienen precios y 6 de Esquiades no tienen ofertas que se puedan cargar (marcadas `unsupported`). |
| 5 | Fuentes de nieve oficiales | Probado con textos reales | Nuevos: Ordino Arcalís, Pal Arinsal, sectores de Grandvalira (sin km por sector), Port del Comte y Aramón (Cerler, Formigal-Panticosa). Pirineu365 carga por JS: pendiente de temporada. Baqueira responde 403 a los bots: no se elude. |
| 5b | Comprobación online | Escrita | Distingue transporte, extracción, «sin datos» legítimo, estructura incompatible, bloqueo y robots. |
| 5c | Distancias | Contrastado | 35 de 38 rutas corregidas con OSRM (OpenStreetMap) el 01/10/2026. Varias heredadas estaban muy mal (Sabadell→Boí Taüll: 190→293 km). Núria (sin carretera) y Tarragona→Port Ainé siguen heredadas y marcadas. |
| 6 | Costes por destino y candidatura | Probado (local) | Migración 0009. Pruebas de API y e2e con dos estaciones, cambio de destino, estimaciones aparte y datos que faltan. |
| 7 | Open Prices | Contrastado | Nombres y tipos de campo comprobados con la respuesta real. Hay precios con `date: null`, que se descartan (`open-prices-shape.test.ts`). |
| 7b | Tickets en PDF | Probado (local) | pdf.js se carga bajo demanda y lee el PDF en el navegador, sin subirlo. Un PDF sin texto explica la alternativa. Probado en el build de Pages con su CSP. Sin OCR. |
| 8 | Migración de la hoja | Probado (local) | e2e: Administración importa el CSV (vista previa, errores, idempotente, copia íntegra), asigna cada nombre y la persona incorpora lo que quiere. **Falta la exportación real.** |
| 8b | Copia y restauración | D1 Time Travel en el despliegue; `backup.ts` probado en local | Restauración remota sin probar |
| 9 | CI real, uso y CPU medidos | **Pendiente** | Necesita push y la cuenta de Cloudflare |
| 10 | Administración por UID real | Workflow escrito | `v2-admin.yml` valida el UID; nunca se usa el alias |

## Errores encontrados en esta ronda

- **YAML del workflow de la API no válido:** un nombre de paso contenía «: » y GitHub lo habría rechazado. Ahora `npm run test:workflows` analiza todos los workflows.
- **El buscador de cuentas de Administración no funcionaba:** a la URL le faltaba «?», devolvía 404 y no se podía asignar ningún nombre de la hoja. Lo detectó la e2e nueva.
- **El robots.txt se interpretaba mal:** `Disallow: /*/hotel/offer/load` se convertía en «/» y bloqueaba todo Esquiades.
- **Distancias heredadas erróneas:** ver 5c.

## Pendiente online o de David (01/10/2026, ya resuelto)

- Push a `Lilru-tech/skitrip`: davidcliqpod no tiene permiso de escritura. Se entrega como bundle.
- Cloudflare: los tres secretos.
- Firebase: la configuración web y el dominio autorizado.
- Pages: cambiar la fuente en el momento de publicar.
- CSV de las tres pestañas de la hoja.
- Primera ejecución online de los recolectores y de la comprobación. Hasta entonces, todas las fuentes siguen «sin verificar».
- Medir en Cloudflare la CPU real y el uso de D1 con 10–20 personas, y comprobar las cabeceras reales de Pages.

## No soportado por la fuente

- Búsqueda exacta de hoteles en Esquiades y Estiber (robots.txt). No hay API pública ni programa de afiliación.
- Ordino Arcalís y Pal Arinsal no publican km. Grandvalira no publica km por sector.
- Pirineu365 muestra «–» fuera de temporada. Ax solo muestra un mapa. Baqueira bloquea a los bots.
- Los históricos hoteleros antiguos no tienen hotel, noches ni fechas: solo sirven como referencia agregada.
- Mercadona: sin autorización. El adaptador directo sigue deshabilitado.
