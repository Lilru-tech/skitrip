# Validación

Fecha: 01/10/2026. Rama `rebuild/v2`, commit c66957a. Todo lo que figura aquí se ha ejecutado en el entorno de desarrollo, que no tiene cuentas de Cloudflare ni Firebase ni permiso de push. Sus scripts no salen a las webs de estaciones y proveedores; esas webs se han leído con una herramienta de lectura web, que devuelve texto y no el HTML crudo.

**SkiTrip v2 no está publicado.** Faltan los accesos de `ACCESOS.md`. Ningún workflow se ha ejecutado en GitHub, y uno omitido no cuenta como probado.

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

## Pendiente online o de David

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
