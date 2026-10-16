# Consultas D1, CPU y cuotas en el plan Free

Fecha: 01/10/2026 (tabla de sentencias regenerada ese día). Rama `rebuild/v2`. Límites consultados ese día en https://developers.cloudflare.com/d1/platform/limits/ y https://developers.cloudflare.com/workers/platform/limits/.

## Límites que condicionan el diseño

| Límite (Free) | Valor | Cómo se respeta |
|---|---|---|
| Consultas D1 por invocación del Worker | 50 | Cada sentencia cuenta, **también cada sentencia dentro de un `batch`** (un batch no reinicia el contador). El Worker envuelve D1 con un contador (`src/worker/d1budget.ts`) y corta a **40** con un 503 `query_budget` antes de llegar a 50. |
| Parámetros por sentencia | 100 | Las listas no se expanden en `?1, ?2, …`: se envían como un único parámetro JSON y se leen con `json_each` (`IN (SELECT value FROM json_each(?))`, `INSERT … SELECT … FROM json_each(?)`). |
| Longitud de la sentencia SQL | 100 KB | El SQL es fijo; los datos van en parámetros. |
| Fila o cadena | 2 MB | La parte más grande es la importación de la hoja: 1.000 filas por sentencia (unos 150 KB) y el CSV troceado en partes de 40.000 caracteres. |
| CPU por petición del Worker | 10 ms | Ver «CPU» más abajo. |
| Filas leídas / escritas al día | 5 M / 100.000 | Uso previsto para 10–20 personas muy por debajo. |

No se recomienda ni se necesita el plan de pago: **las 131 rutas del Worker** quedan en 19 sentencias o menos con los volúmenes medidos (ver abajo qué no se ha medido).

## Sentencias medidas por ruta

Medido con `test/worker/quota-audit.test.ts` y `test/worker/quota-audit-all.test.ts` (el resto), contra D1 local (workerd). Se cuentan todas las sentencias de la petición: autenticación, límites de uso, lecturas, escrituras y cada sentencia de un batch. Los tests fallan si alguna pasa de 40.

**Cobertura comprobada:** `quota-audit-all.test.ts` lee las definiciones de rutas de `src/worker/index.ts` y `src/worker/routes/*.ts` y falla si alguna no aparece medida. Lo mismo desde Node: `npx tsx tools/check-audit-coverage.ts` (resultado del 01/10/2026: «Rutas definidas: 109 · medidas: 109»; con las listas generales de la migración 0010 y la guía de datos antiguos, 125 · 125 el 03/10/2026). Las tablas se imprimen con `npx vitest run test/worker/quota-audit*.test.ts --reporter=verbose`. Algunas rutas tienen una fila por variante (p. ej. `accept`/`reject`/`cancel`).

| Ruta | Sentencias (máx.) | Volumen |
|---|---|---|
| `PUT /trips/:id/budget` | 19 | lista de 150, 20 candidaturas |
| `POST /admin/legacy/sheets/import` | 14 | 5.000 filas (máximo por importación) |
| `PUT /trips/:id/destination-costs/:areaId` | 13 | lista de 150, 20 candidaturas |
| `POST /ingest/offers` | 12 | 180 ofertas (60 de escenario + 2 × 60 de catálogo) |
| `GET /trips/:id/budget` | 11 | 150 artículos, 30 productos × 10 fechas |
| `GET /trips/:id/cost-comparison` | 11 | 20 candidaturas |
| `POST /trips/:id/cost-comparison` | 11 | otra salida fija u origen personalizado (19 estaciones) |
| `POST /geo/routes` | 5 | 19 estaciones con ruta |
| `POST /geo/search` | 4 | — |
| `GET /geo/status` | 2 | — |
| `PUT /trips/:id/expenses/:eid` | 11 | 8 beneficiarios |
| `GET /public/areas/:id` | 10 | — (incluye las rutas desde cada origen) |
| `POST /trips/:id/scenarios` | 9 | — |
| `POST /shopping-lists/:lid/copy` | 9 | 299 decisiones: 150 altas, sumas y omisiones |
| `POST /receipts/confirm` | 8 | 10 líneas asociadas |
| `POST /trips/:id/invitations` | 8 | — |
| `POST /trips/:id/shopping/items` | 8 | lista de 150 |
| `POST /trips/:id/shopping/legacy-import` | 8 | 140 artículos |
| `POST /friends/requests` | 7 | — |
| `POST /ingest/snow` | 7 | 33 fuentes (catálogo completo) |
| `POST /receipts/:rid/expense` | 7 | 8 participantes |
| `POST /trips/:id/expenses` | 7 | 8 beneficiarios |
| `POST /trips/:id/transfer` | 7 | — |
| `POST /trips/invitations/accept-link` | 7 | 8 miembros |
| `GET /admin/health` | 6 | capturas, fuentes y áreas del catálogo |
| `GET /availability/trip/:id` | 5 | 8 miembros × 150 días |
| `GET /public/catalog` | 6 | 24 áreas |
| `GET /trips/:id/shopping` | 6 | 150 artículos, 30 productos × 10 fechas |
| `PATCH /trips/:id/shopping/items/:itemId` | 6 | lista de 150 |
| `POST /friends/blocks` | 6 | 38 amigos |
| `POST /me` | 6 | — |
| `POST /shopping-lists/:lid/legacy-import` | 6 | 200 artículos (máximo por petición) |
| `POST /shopping-lists/:lid/copy/preview` | 6 | 299 artículos frente a 150 del viaje |
| `DELETE /trips/:id/expenses/:eid` | 5 | 40 gastos × 8 |
| `DELETE /trips/:id/members/:userId (abandonar)` | 5 | 8 miembros |
| `DELETE /trips/:id/members/:userId` | 5 | 9 miembros |
| `DELETE /trips/:id/settlements/:sid` | 5 | 40 gastos × 8 |
| `GET /friends` | 5 | 7 amigos |
| `GET /trips/:id/expenses` | 5 | 40 gastos × 8 |
| `GET /trips/:id/scenarios` | 5 | 4 escenarios |
| `GET /trips/:id/shopping/basket` | 5 | 150 artículos, 30 productos × 10 fechas |
| `GET /trips/:id` | 5 | 8 miembros |
| `PATCH /trips/:id` | 5 | — |
| `POST /friends/requests/:id/accept` | 5 | — |
| `POST /prices/import/confirm` | 5 | 500 filas |
| `POST /trips/:id/settlements` | 5 | 40 gastos × 8 |
| `POST /trips` | 5 | — |
| `PATCH /shopping-lists/:lid/items/:itemId` | 5 | lista de 300 |
| `POST /admin/legacy/identities/link` | 5 | 150 días + 500 comentarios de un nombre |
| `DELETE /comments/:cid` | 4 | — |
| `DELETE /trips/:id/candidates/:cid` | 4 | 20 candidaturas × 8 votos |
| `DELETE /trips/:id/scenarios/:sid` | 4 | 4 escenarios |
| `DELETE /trips/:id/shopping/items/:itemId` | 4 | lista de 150 |
| `DELETE /trips/:id` | 4 | viaje completo (gastos, compra, tickets, candidaturas, comentarios) |
| `GET /availability/common` | 4 | 8 miembros × 150 días |
| `GET /products/:pid/open-prices` | 4 | caché vigente |
| `GET /products/:pid/prices (cadena de 10 sustituciones)` | 4 | 10 sustituciones, 5 precios |
| `GET /trips/:id/shopping/legacy` | 4 | 200 artículos legacy, lista de 150 |
| `GET /trips/:id/shopping/suggestions/:itemId` | 4 | 30 productos |
| `PATCH /comments/:cid` | 4 | — |
| `PATCH /trips/:id/candidates/:cid` | 4 | 20 candidaturas × 8 votos |
| `POST /admin/legacy/availability/reconcile` | 4 | 150 días |
| `POST /admin/legacy/comments/:lid/reconcile` | 4 | — |
| `POST /comments` | 4 | privado de viaje |
| `POST /legacy/availability/mine/incorporate` | 4 | 150 días |
| `POST /prices` | 4 | — |
| `POST /products/:pid/replace` | 4 | — |
| `POST /products` | 4 | — |
| `POST /trips/:id/candidates` | 4 | — |
| `POST /trips/:id/invitations/:invId/revoke` | 4 | — |
| `POST /trips/invitations/:id/accept` | 4 | — |
| `PUT /availability/shares` | 4 | 1 viaje |
| `PUT /availability/trip/:tripId/proposals/:pid/vote` | 4 | 6 propuestas × 8 |
| `PUT /trips/:id/candidates/:cid/vote` | 4 | 20 candidaturas × 8 votos |
| `PUT /trips/:id/shopping/list` | 4 | lista de 150 |
| `POST /shopping-lists/:lid/items` | 4 | hasta 300 artículos |
| `GET /shopping-lists/:lid` | 4 | 299 artículos, 30 productos con 500 precios |
| `DELETE /trips/:id/destination-costs/:areaId` | 3 | — |
| `GET /offers/:oid/history` | 3 | 367 observaciones |
| `GET /products/:pid/prices` | 3 | 10 observaciones |
| `GET /trips/:id/candidates` | 3 | 20 candidaturas |
| `GET /trips/:id/comments` | 3 | 50 comentarios |
| `GET /trips/:id/expenses/history` | 3 | 40 gastos |
| `PATCH /me` | 3 | — |
| `PATCH /trips/:id/members/:userId` | 3 | — |
| `POST /admin/comments/:cid/hide` | 3 | — |
| `POST /admin/users/:uid/block` | 3 | — |
| `POST /admin/users/:uid/unblock` | 3 | — |
| `POST /availability/trip/:tripId/proposals` | 3 | 0 propuestas previas |
| `POST /friends/requests/:id/cancel` | 3 | — |
| `POST /friends/requests/:id/reject` | 3 | — |
| `POST /receipts/preview` | 3 | 42 productos, 10 líneas |
| `POST /trips/invitations/:invId/decline` | 3 | — |
| `PUT /availability/me` | 3 | 150 días |
| `PUT /offers/:oid/save` | 3 | — |
| `GET /shopping-lists/:lid/legacy` | 3 | 200 artículos legacy |
| `DELETE /shopping-lists/:lid/items/:itemId` | 3 | lista de 300 |
| `PATCH /shopping-lists/:lid` | 3 | lista de 300 |
| `DELETE /shopping-lists/:lid` | 3 | 299 artículos, 150 copias en un viaje |
| `GET /admin/legacy/summary` | 3 | 500 comentarios, 8 personas × 150 días + 20 × 250 |
| `POST /admin/legacy/comments/publish` | 3 | 500 comentarios elegidos (máximo por petición) |
| `DELETE /friends/:userId` | 2 | 38 amigos |
| `DELETE /friends/blocks/:userId` | 2 | — |
| `DELETE /offers/:oid/save` | 2 | — |
| `GET /admin/legacy/availability` | 2 | 8 personas × 150 días |
| `GET /admin/legacy/comments` | 2 | 500 comentarios legacy |
| `GET /admin/users` | 2 | 47 cuentas |
| `GET /admin/users/search` | 2 | 10 cuentas como máximo |
| `GET /availability/me` | 2 | 150 días |
| `GET /availability/shares` | 2 | 1 viaje + amigos |
| `GET /availability/visible` | 2 | 8 miembros × 150 días |
| `GET /friends/search` | 2 | 46 cuentas |
| `GET /legacy/availability/mine` | 2 | 150 días |
| `GET /me/prefs` | 2 | — |
| `GET /notifications` | 2 | — |
| `GET /notifications/unread` | 2 | 100 avisos sin leer |
| `GET /products/:pid/open-prices (sin EAN)` | 2 | — |
| `GET /products?q=` | 2 | 30 productos |
| `GET /receipts` | 2 | 10 tickets |
| `GET /trips/invitations/mine` | 2 | 5 pendientes |
| `GET /trips` | 2 | 1 viaje |
| `POST /notifications/read (100 ids)` | 2 | 100 IDs (máximo), todos sin leer |
| `POST /notifications/read` | 2 | 60 avisos sin leer, todos |
| `POST /prices/import/preview` | 2 | 500 filas |
| `PUT /me/prefs` | 2 | — |
| `POST /shopping-lists` | 2 | — |
| `GET /shopping-lists` | 2 | 20 listas |
| `GET /ingest/offer-sources` | 1 | 19 fuentes |
| `GET /ingest/scenarios` | 1 | 4 escenarios activos |
| `GET /ingest/snow-sources` | 1 | 33 fuentes |
| `GET /me` | 1 | — |
| `GET /public/sources` | 1 | 52 fuentes |
| `GET /public/tips` | 1 | — |
| `GET /health` | 0 | — |
| `GET /public/capabilities` | 0 | — |

Medidas también con su propio test:

| Ruta | Máximo comprobado | Volumen | Test |
|---|---|---|---|
| `POST /ingest/snow` | ≤ 8 (igual con 1 que con 29 fuentes) | catálogo real completo | `quotas.test.ts` |
| `POST /ingest/offers` | ≤ 14 | 19 páginas × 10 ofertas (190) | `quotas.test.ts` |
| `POST /prices/import/preview` | ≤ 10 | CSV de 500 filas | `review-fixes.test.ts` |
| `POST /prices/import/confirm` | ≤ 12 | CSV de 500 filas | `review-fixes.test.ts` |
| `POST /notifications/read` | 2 con 50 y con 100 IDs | IDs repetidos, ajenos y lista vacía | `review-fixes.test.ts` |

### Qué no se ha medido o tiene límites

- `GET /products/:pid/open-prices` sin caché: haría una llamada real a prices.openfoodfacts.org, así que solo se midió con caché vigente (4) y sin EAN (2). Leyendo el código, el camino sin caché añade una escritura (5).
- Los volúmenes son los de la tabla. Un viaje con más datos de los medidos no está medido, aunque las consultas no dependen del número de filas (listas por `json_each`).
- Solo D1 local. No se ha ejecutado contra D1 remoto.

### Bucles acotados

- `POST /prices/import/confirm`: inserción en trozos de 250 filas; con el tope de 500 filas son como mucho 2 sentencias.
- `GET /products/:pid/prices`: la cadena de sustituciones (máx. 10) era una consulta por salto y, además, se cortaba tras el primero. Ahora es una sola sentencia recursiva y devuelve la cadena completa (test con 10 sustituciones).
- `PUT /trips/:id/budget` calcula el presupuesto antes y después de guardar: 19 sentencias fijas, la más alta (incluye los costes por estación).
- `POST /admin/legacy/sheets/import`: como mucho 5.000 filas y 450 KB por petición. Son 1.000 filas por sentencia (un parámetro JSON) más 12 partes de la copia íntegra: 14 sentencias en el máximo. Más filas se rechazan con un 422 que pide dividir el CSV, y cada parte se importa sin duplicar.
- No queda ninguna ruta que emita una sentencia por elemento. `POST /notifications/read` lo hacía (50 IDs → 503) y ahora usa una sola sentencia.

Antes de las revisiones la ingesta hacía 54 consultas por POST, marcar avisos una por ID, la importación CSV hacía 1–2 por fila (503 con 500 filas), el calendario una por día y la lista de escenarios dos por escenario.

## Origen personalizado (Geoapify Free)

Comprobado el 15/10/2026 en https://www.geoapify.com/pricing/ y https://www.geoapify.com/term-and-conditions/: plan Free de **3.000 créditos al día**, 5 peticiones por segundo, sin tarjeta y con uso comercial permitido si se muestra «Powered by Geoapify» y la atribución de OpenStreetMap. El tope es «blando»: Geoapify puede suspender la cuenta si se supera a menudo, y repartir el uso entre varias cuentas está prohibido. Las condiciones no dicen nada sobre guardar resultados.

| Acción | Créditos | Cuándo se gasta |
|---|---|---|
| Buscar una dirección | 1 | Al pulsar «Buscar» (nunca al escribir) |
| Calcular distancias | 1 por estación (hoy 19) | Al pulsar «Calcular distancias desde aquí» (nunca al mover el mapa) |
| Mapa | 0 | Teselas de OpenStreetMap (tile.openstreetmap.org) con atribución; no usan la clave ni créditos |

- **Topes propios** (tabla `geo_usage`, por día UTC): 2.000 créditos al día en total (deja 1.000 de margen) y 250 por persona (unas 12 consultas de distancias con sus búsquedas). Se reserva antes de llamar al proveedor; al llegar al tope se responde 429 con el motivo y la web ofrece Tarragona o Sabadell. Ajustables con `GEO_DAILY_CREDITS` y `GEO_USER_DAILY_CREDITS`.
- **Uso previsto para 20 personas**: cambiar de origen cuesta unos 20 créditos (1 búsqueda + 19 estaciones). Si cada persona lo hace 2 veces por semana, son 800 créditos a la semana, unos 115 al día de media: un 4 % del plan. Un día de mucho uso (las 20 a la vez, 2 orígenes cada una) serían ~800 créditos (27 %).
- **Reutilización**: las distancias calculadas se reutilizan en la pestaña sin volver a consultar; con «Recordar en este navegador» se guardan solo en ese navegador hasta 30 días. El Worker no guarda direcciones, coordenadas ni resultados.
- **D1**: 4–5 sentencias por consulta (ver tabla de arriba) y una fila por persona y día en `geo_usage`, que el cron diario borra pasados 35 días.

## Ejecuciones de captura por partes

- Cada POST de ingesta admite como máximo 200 filas. Los recolectores (`tools/collectors/*.ts`) parten el lote con `chunkBy` y envían `part`/`parts` con recuentos por parte.
- La ejecución queda `running` hasta recibir todas las partes. El estado final se calcula con la suma de todas las partes y el número real de filas guardadas.
- Reenviar una parte es idempotente: no duplica recuentos ni convierte una ejecución válida en vacía o errónea (probado en `quotas.test.ts`).

## CPU (10 ms)

### Cómo se mide (gratis)

- **Analítica de Workers (GraphQL, `workersInvocationsAdaptive`)**: percentiles de CPU (p50, p99, p99.9) y peticiones por estado (`success`, `exceededCpu`, `exceededResources`…), sin la ruta. Necesita el permiso «Account Analytics: Read» del token.
- **`wrangler tail --format json`**: CPU por petición con la URL. Las rutas se agrupan sin IDs (`tools/cpu-summary.ts`).
- **«v2 · medir CPU»** (`v2-cpu-probe.yml`, manual): abre el tail y lanza `tools/cpu-probe.ts`. Hace grupos de peticiones separados 3 s por las rutas públicas, de ingesta y autenticadas con dos cuentas de prueba (`prod-check-<ejecución>-p/q`, que borra al final por ID exacto) y, opcionalmente, los recolectores de nieve y ofertas. Luego cruza cada ventana con la analítica. Con alcance «acotada» solo mide el catálogo y la disponibilidad del viaje en tres ráfagas, y anota el isolate de cada petición. Antes de medir imprime las consultas de D1 con más filas leídas en 24 h (`tools/d1-insights.ts`, con los literales sustituidos por «?» porque el registro es público).
- **«v2 · vigilancia»** (`v2-watch.yml`, diaria a las 09:23 UTC): salud de la API, peticiones, errores, cortes por CPU y p99 de 24 h, tamaño y filas de D1, perfiles (y restos de pruebas), antigüedad de las capturas, edad y cobertura de cada fuente prioritaria (nieve oficial y páginas de ofertas) y el resto de fuentes con 3 o más fallos seguidos. Está separada de la copia y restauración (`v2-recovery-check.yml`). Política (`tools/watch-policy.ts`, desde el 15/10/2026), guardada por días en D1 (`watch_findings`) y visible en Administración → «Vigilancia diaria»:
  - **Aviso aislado**: un AVISO de un día. Se muestra; no avisa.
  - **Degradación repetida**: el mismo AVISO en días naturales consecutivos con observación (2 para una fuente que funcionaba y dejó de hacerlo, como La Molina el 12/10; 3 para el resto). Varias ejecuciones el mismo día cuentan como un día. Un día sin observación (el workflow no corrió) no cuenta como degradación ni como recuperación: la racha vuelve a empezar en 1 y un issue abierto sigue abierto hasta una observación OK. Abre **un** issue con la etiqueta `vigilancia`, que se cierra solo al volver a OK, sin comentarios diarios, y añade un `::warning::` a la ejecución.
  - **Fallo real** (API caída, cortes por CPU, cuotas, captura sin éxito fuera de plazo): el workflow queda en rojo (GitHub avisa por correo) y también abre el issue.
  - Fuera de temporada o «sin parte publicado» confirmado por la fuente es OK y queda como pendiente de invierno, no como degradación.
  - **Mecanismos de la vigilancia** (`tools/watch-run.ts`): en Actions, leer `watch_findings`, guardarlo y gestionar los issues son obligatorios. Si alguno falla, la ejecución sale en rojo con `::error::Vigilancia: …` aunque todas las comprobaciones estén bien. Si no se puede leer el estado, no se calcula ni se guarda ninguna racha y no se tocan los issues: se conserva el estado anterior en lugar de reiniciarlo todo como «aislado» cada día. Si falla GitHub, el estado se guarda y el issue se reintenta al día siguiente con el listado real (sin duplicados). Fuera de Actions es una **ejecución local**: no lee ni escribe estado ni toca issues, y lo dice («MODO LOCAL»). Las filas sin observar en 14 días se borran; una consulta que falla un día no borra rachas. Pruebas: `watch-policy.test.ts` (consecutivos, huecos, mismo día, recuperación) y `watch-run.test.ts` (flujo completo con D1 y GitHub simulados).

### Catálogo público y lecturas de D1 (15/10/2026, tarde)

**Qué consumía CPU en el catálogo.** El código del catálogo no cambió con la PR #10, pero su CPU pasó de p50 3 ms (sondeo 38704461036, antes de publicar) a p50 9–10 ms (38713197532 y 38714990287) y, en el sondeo acotado 38732558754, a p50 17 ms (24 peticiones, 17 por encima de 10 ms). Lo que cambió fueron los datos: tras la PR #10 casi todas las fuentes de nieve publican fecha de parte, y cada candidata con fecha llama a `todayMadrid()` en `pickSnow`, `snowForRanking` y la frescura. `todayMadrid()` creaba un `Intl.DateTimeFormat` con zona horaria en cada llamada, y crearlo cuesta del orden de 0,1–0,5 ms (resolver la zona en ICU); formatear con uno ya creado, microsegundos. Con 29 fuentes eran decenas de formateadores por petición, más la basura que dejan. En Node, la parte del catálogo que no es D1 baja de 22,7 ms a 0,22 ms por petición con los mismos datos (la cifra absoluta de Node no es la de Cloudflare, pero la proporción indica dónde estaba el coste).

**Qué leía D1.** `wrangler d1 insights` (24 h hasta el 15/10 12:11 UTC, 1,79 M filas en las 100 consultas listadas):

| Filas leídas | % | Ejecuciones | Media | Consulta |
|---|---|---|---|---|
| 506.166 | 28,3 | 87 | 5.818 | ficha de estación: serie legacy de nieve (sin índice por ámbito) |
| 395.226 | 22,1 | 85 | 4.649 | ficha de estación: serie legacy de hotel (sin índice por ámbito) |
| 294.800 | 16,5 | 11 | 26.800 | catálogo: última nieve legacy por área (la tabla entera dos veces) |
| 258.576 | 14,4 | 24 | 10.774 | escenarios del viaje: observaciones de ofertas (sin índice por escenario) |
| 94.794 + 82.093 | 9,9 | 42 + 59 | ~2.000 | calendario: disponibilidad de 16 personas × 150 días (lectura necesaria) |

Las cuatro primeras, el 81 %, recorrían tablas enteras en cada petición. Casi todas las ejecuciones de hoy son de los sondeos de CPU y de los recorridos de producción, no de uso real.

**Cambios (PR de esta corrección).**
- `todayMadrid()` usa un formateador creado una vez por isolate y recuerda el último resultado para el mismo instante; se sigue calculando con la hora de cada petición (la fecha cambia a medianoche de Madrid, con prueba de verano, invierno y cambio de hora). Igual para km y euros (`Intl.NumberFormat`).
- Última nieve por fuente: una búsqueda por índice por cada fuente de nieve (la ingesta solo acepta observaciones en el ámbito de su fuente) en lugar de una ventana sobre todo el histórico, que crece con cada captura.
- Migración 0015: índices `legacy_snow_scope`, `legacy_hotel_scope` y `offer_obs_scenario`. La última nieve legacy por área se calcula área por área con el índice.
- Mismos resultados que las consultas anteriores (`catalog-reads.test.ts` compara con ellas, incluido el desempate por id con la misma hora). Sin caché nueva: los datos siguen siendo los de D1 en cada petición.

**Filas leídas por petición (local, mismos volúmenes que producción: 5.394 filas legacy de nieve, 4.480 de hotel, 29 fuentes de nieve)** con la cabecera `X-D1-Rows-Read` del modo emulador:

| Ruta | Antes | Después |
|---|---|---|
| `GET /api/public/catalog` (20 capturas por fuente) | 30.090 | 358 |
| `GET /api/public/catalog` (300 capturas por fuente, final de temporada) | 76.300 | < 600 (no crece con el histórico) |
| `GET /api/public/areas/:id` | 5.902 (sin la serie de hotel) | < 1.000 con las dos series |

**Medición acotada en producción** (`v2 · medir CPU` con alcance «acotada»: tres ráfagas de 8 peticiones al catálogo y tres de 10 a la disponibilidad del viaje con 16 personas, separadas ~20 s; 63 peticiones en total). Antes de publicar, sondeo 38732558754:

| Ráfaga | Catálogo: 1.ª · resto p50 / máx (ms) | >10 ms | Viaje (16): 1.ª · resto p50 / máx (ms) | >10 ms |
|---|---|---|---|---|
| 1 | 18 · 9 / 10 | 1 de 8 | 17 · 6 / 8 | 1 de 10 |
| 2 | 31 · 17 / 27 | 8 de 8 | 21 · 10 / 14 | 5 de 10 |
| 3 | 25 · 21 / 29 | 8 de 8 | 10 · 5 / 7 | 0 de 10 |

Con el mismo código y los mismos datos, la misma ruta varía de una ráfaga a otra hasta el doble, también en las peticiones repetidas. Por eso la medición ahora anota qué isolate atendió cada petición (cabecera `X-SkiTrip-Probe` del sondeo; una línea en el registro del Worker que solo ve `wrangler tail`): una primera petición lenta solo se atribuye a un isolate nuevo si su número de petición es 1. Después de publicar (PR #12, release 38736977323), sondeo 38738050166, mismo escenario (66 peticiones):

| Ráfaga | Catálogo: 1.ª · resto p50 / máx (ms) | >10 ms | Isolate de la 1.ª | Viaje (16): 1.ª · resto p50 / máx (ms) | >10 ms | Isolate de la 1.ª |
|---|---|---|---|---|---|---|
| 1 | 11 · 2 / 3 | 1 de 8 | nuevo (n = 1) | 19 · 10 / 14 | 5 de 10 | n = 6 |
| 2 | 2 · 2 / 3 | 0 de 8 | n = 9 | 7 · 10 / 13 | 4 de 10 | n = 16 |
| 3 | 3 · 2 / 2 | 0 de 8 | n = 17 | 13 · 9 / 12 | 5 de 10 | n = 26 |

- **Catálogo**: p50 de 17 a 2 ms con 24 peticiones en cada medición; por encima de 10 ms, de 17 a 1. Esa una es la primera petición de un isolate recién creado (n = 1, 11 ms): ahí sí hay evidencia de arranque en frío.
- **Disponibilidad del viaje (16 personas)**: no está resuelta. Las 30 peticiones las atendió un único isolate ya usado (n = 6 a 36, ninguno nuevo) y aun así el p50 fue 10 ms y 14 de 30 pasaron de 10 ms. Las primeras peticiones lentas de cada ráfaga (19 y 13 ms) no son arranques en frío. Antes de este cambio, el mismo escenario dio p50 6, 10 y 5 ms por ráfaga, y en los sondeos completos de la mañana, 10 y 6 ms. Con un mismo isolate el coste es estable dentro de la medición y cambia entre mediciones (también el tiempo real: ~230 ms antes frente a ~480 ms ahora), lo que apunta a la máquina o ubicación que atiende la medición más que al número de peticiones; con estas muestras no se puede confirmar. La ruta queda en torno al límite de 10 ms con 16 personas y 150 días: es el siguiente candidato a optimizar.
- **Vigilancia** después del cambio (38738977781): 0 fallos, 0 degradaciones, 0 errores de los mecanismos. Filas leídas en 24 h: 2.809.528. Es la ventana acumulada y todavía incluye todas las lecturas anteriores al cambio (los sondeos del día con las consultas sin índice); la bajada se verá en las vigilancias de los próximos días.

### Disponibilidad del viaje con 16 personas (15/10/2026, tarde)

**Qué consumía CPU, medido antes de cambiar nada.** Producción no da un perfil por función, así que la ruta se perfila en local con la misma carga que «v2 · medir CPU» (2 cuentas, 14 miembros sintéticos, 150 días cada uno, viaje de 16): `tools/bench/trip-cpu.mts` ejecuta el Worker real en Node sobre un D1 mínimo con SQLite y las migraciones reales (`tools/bench/d1-node.ts`). Con `MEMO=1` las lecturas repetidas devuelven el resultado guardado, de modo que lo que se mide es el trabajo del Worker y no el de SQLite (que en Cloudflare corre en D1, fuera de la CPU del Worker). Perfil de V8 (`node --cpu-prof`, 3.000 peticiones), tiempo propio del Worker:

- Leer los días de cada persona: `JSON.parse` de los 16 objetos de ~150 claves que devuelve D1 (`json_group_object`) y después una búsqueda por texto por persona y día. Era la parte mayor.
- Generar las 150 fechas del rango (`eachDay`): cada día pasaba por `split`, `Date` y `toISOString`.
- El resto (recuento diario, intervalos, montar la respuesta) es menor. La respuesta (~57 KB) ya se montaba reenviando el JSON de D1 sin volver a serializarlo.
- Viajes a D1: 6 sentencias (usuario, pertenencia, miembros, permisos, días, propuestas), cada una con su ida y vuelta.

**Cambios.**
- `codesFromDayObject` (`core/calendar.ts`) lee el texto de `json_group_object` directamente a un código por día: la posición sale de la propia fecha y no se crea ningún objeto. Si el texto no tiene exactamente la forma esperada (claves fuera de orden, una fecha que no existe, espacios…), devuelve null y la ruta hace el cálculo de siempre con `JSON.parse`. Los días se siguen reenviando tal cual en la respuesta.
- `eachDay` calcula día, mes y año con enteros (misma lista: comparada con el avance día a día con `addDays` entre 1999 y 2100).
- Miembros y propuestas en un solo batch; la pertenencia se decide con esa misma lista de miembros. Quien no es miembro recibe el mismo 404, también con un rango no válido, como antes. 5 sentencias en lugar de 6.
- No se reducen personas, fechas ni intervalos: mismo rango, mismo límite de 30 intervalos y la misma regla de permisos (`visibleAvailabilityOwners`).

**Equivalencia y permisos en local.**
- Respuesta idéntica byte a byte antes/después con la carga de 16 personas, normalizando solo los identificadores aleatorios, en cuatro variantes de noches y mínimo (una con 30 intervalos).
- `test/worker/trip-availability.test.ts`: oculto (no comparte o bloqueado) frente a sin indicar (comparte sin días), permiso por viaje sin amistad, bloqueo, día guardado que no es una fecha real, días fuera del rango, 404 para quien no es miembro y 422 para un rango no válido. Recuento e intervalos comparados con el cálculo anterior. La misma prueba pasa con el código anterior (con 6 sentencias).
- `test/core/calendar-codes.test.ts`: 400 calendarios pseudoaleatorios contra `JSON.parse` y las formas raras que deben devolver null.

**Indicador local** (Node 22, `MEMO=1`, 2.000 peticiones, 5 ejecuciones de cada versión): peticiones repetidas p50 1,36–1,61 → 0,80–1,01 ms y p90 2,05–2,23 → 1,24–2,11 ms. La primera petición de cada proceso (7–10 ms antes, 7–14 ms después) incluye compilar el código y no muestra un cambio claro.

**Medido en producción después de publicar** (PR #14, v2-release 38745169649; sondeo acotado 38746509017, mismo escenario y mismas muestras que 38738050166: 3 ráfagas de 8 al catálogo y 3 de 10 al viaje, 16 personas × 150 días). CPU de `wrangler tail` en ms:

| Ráfaga | Viaje antes (38738050166): 1.ª · resto p50 / máx · >10 ms | Viaje después (38746509017) | Isolate de la 1.ª (después) |
|---|---|---|---|
| 1 | 19 · 10 / 14 · 5 de 10 | 8 · 3 / 6 · 0 de 8 | n = 36 |
| 2 | 7 · 10 / 13 · 4 de 10 | 6 · 3 / 8 · 0 de 10 | n = 46 |
| 3 | 13 · 9 / 12 · 5 de 10 | 3 · 3 / 5 · 0 de 10 | n = 56 |

- Viaje: p50 10 → 3 ms; por encima de 10 ms, 14 de 30 → 0 de 28 (el tail perdió 2 eventos de la primera ráfaga; la analítica contó las 10 + 10 + 11 peticiones, con p50 4,4 / 3,5 / 3,4 y p99 8,5 / 8,6 / 5,5 ms). Máximo 8 ms. Las 30 en un mismo isolate ya usado, como antes. Tiempo real p50 ~165 ms (antes ~480 ms), con una ida y vuelta a D1 menos.
- Catálogo, sin cambios en esta PR: p50 2 ms, 0 de 24 por encima de 10 ms; la primera petición de un isolate nuevo (n = 1) 9 ms.
- Resultados `ok` en las 59 peticiones del tail; ningún corte.
- Limpieza: 16 cuentas del manifiesto, perfiles 17 → 1, administradores 1, restos de la prueba 0.
- Es una sola medición. Con el código anterior el mismo escenario dio p50 entre 5 y 10 ms según la ejecución; el 3 de ahora queda por debajo de la mejor de ellas, pero el margen real se confirmará con las siguientes mediciones.

**D1 en la misma ejecución** (`wrangler d1 insights`, 24 h hasta las 13:53 UTC): 2.411.573 filas en las 100 consultas listadas. Es la ventana acumulada y sigue dominada por consultas que ya no existen o que antes recorrían tablas enteras (la última nieve legacy del catálogo con la forma anterior, 643.200; las series de la ficha de estación antes del índice, 506.166 y 395.226; escenarios sin índice, 258.576) y por los sondeos del día. La lectura de días del calendario (267.167 filas en 141 ejecuciones, ~1.900 por ejecución) es la lectura necesaria de 16 × 150 días y no cambia con esta PR. La bajada se comprobará en las vigilancias programadas del 16/10 (todavía con los sondeos del 15/10) y del 17/10 (primera ventana sin ellos).

**Lo que no explica el perfil local.** En Node el trabajo del Worker para esta ruta es de ~1,5 ms, y en producción la misma ruta da 6–10 ms con un isolate ya usado. Esa diferencia no aparece en el perfil local: el binding de D1, el entorno de ejecución de Cloudflare y la forma de medir la CPU allí no se pueden perfilar desde aquí. No se atribuye a la infraestructura sin evidencia: la medición acotada después de publicar dirá cuánto baja.

### Medido en producción el 15/10/2026 (grupo de 16 personas)

La vigilancia del 14/10 (run 38581604252) vio 33 peticiones en 24 h, ninguna cortada, p50 7,3 ms y p99 20,8 ms. Con tan pocas peticiones eso no demuestra una regresión ni que se cumpla el límite, así que se midió por ruta con una carga de grupo:

- **Carga** (`tools/cpu-probe.ts` + `tools/cpu-group-sql.ts`): 2 cuentas de prueba reales (`prod-check-<ejecución>-p/q`) y 14 miembros sintéticos insertados en D1 (`pcs-<ejecución>-*`), todos con 150 días de disponibilidad, amistad con la cuenta p y miembros de un viaje. Las altas por la API están limitadas a 5 por IP y hora, por eso los sintéticos van directos a D1. La limpieza borra por los ID y UID exactos del manifiesto (17 → 1 perfiles, administradores 1).
- **Muestras**: 12 peticiones seguidas en las rutas de grupo, 5 en el resto y 20 altas de gasto con 16 participantes. La tabla separa la **primera** petición de la ventana (isolate frío) de las **repetidas** (CPU de `wrangler tail`).

Antes (run 38704461036, código de b0a0a04 publicado; 241 peticiones, todas `ok`, ninguna cortada). CPU en ms:

| Ruta | n | 1.ª | Repetidas p50 / máx. | > 10 ms (repetidas) |
|---|---|---|---|---|
| `GET /api/availability/common` (16 personas × 150 días) | 12 | 27 | 11 / 16 | 7 de 7 |
| `GET /api/availability/trip/:id` (16) | 12 | 14 | 11 / 14 | 4 de 6 |
| `PUT /api/availability/me` (150 días) | 2 | 11 | 28 | 1 de 1 |
| `GET /api/trips/:id/budget` (16) | 12 | 12 | 8 / 11 | 2 de 10 |
| `GET /api/trips/:id/cost-comparison` (16) | 12 | 16 | 7 / 8 | 0 |
| `GET /api/trips/:id/shopping` | 12 | 14 | 6 / 7 | 0 |
| `GET /api/availability/common` (2 personas) | 5 | 5 | 5 / 7 | 0 |
| `POST /api/trips/:id/expenses` (16 participantes) | 20 | 6 | 4 / 8 | 0 |
| `POST /api/me` (alta) | 1 | 13 | — | — |
| Resto (34 rutas) | | ≤ 16 | ≤ 6 | 0 |

El exceso estaba en el **calendario** con muchas personas, no en la autenticación (`GET /api/me` 2 ms) ni en la ingesta (≤ 3 ms en esta medición). Con 16 personas eran 2.400 filas de D1 que el Worker convertía en objetos, recorría dos veces (recuento diario e intervalos, creando los 148 intervalos aunque no llegaran al mínimo) y volvía a serializar (≈ 53 KB). Cambios:

- D1 devuelve una fila por persona con sus días ya en JSON (`json_group_object`); ese texto se analiza una vez para contar y se reenvía tal cual en la respuesta.
- `core/calendar.ts`: códigos por día calculados una vez para el recuento y los intervalos; solo se crean los intervalos que llegan al mínimo. `calendar.test.ts` lo compara con la definición directa.
- `PUT /availability/me`: comprobación por día equivalente al esquema de objeto de zod, que era caro en un isolate frío.
- Mismos permisos (`visibleAvailabilityOwners`), misma transacción de escritura y misma forma de respuesta (`cpu-group.test.ts`).

Indicador local (Node 22, solo el cálculo, sin D1): 16 personas × 150 días, 3,5 → 1,3 ms en caliente.

Después, publicado (PR #10, v2-release 38711486050), con el mismo sondeo, la misma carga y las mismas muestras, medido dos veces porque la primera medición de la disponibilidad del viaje se salió de lo esperado:

| Ruta | Antes (38704461036): 1.ª · rep. p50 / máx. · > 10 ms | Después 1 (38713197532) | Después 2 (38714990287) |
|---|---|---|---|
| `GET /api/availability/common` (16) | 27 · 11 / 16 · 7 de 7 | 10 · 5 / 7 · 0 de 10 | 10 · 5 / 7 · 0 de 11 |
| `GET /api/availability/trip/:id` (16) | 14 · 11 / 14 · 4 de 6 | 20 · 10 / 13 · 6 de 11 | 6 · 6 / 7 · 0 de 12 |
| `PUT /api/availability/me` (150 días) | 11 · 28 · 1 de 1 | 9 · 5 · 0 de 2 | 6 · 4 · 0 de 2 |
| `GET /api/trips/:id/budget` (16) | 12 · 8 / 11 · 2 de 10 | 7 · 4 / 5 · 0 de 12 | 9 · 4 / 5 · 0 de 11 |
| `GET /api/trips/:id/cost-comparison` (16) | 16 · 7 / 8 · 0 | 8 · 7 / 10 · 0 | 7 · 5 / 7 · 0 |

Analítica de Cloudflare (p50 / p99 de la ventana): fechas comunes 11,7 / 27,2 → 5,3 / 10,7 y 5,8 / 10,7; viaje 11,8 / 14,1 → 10,9 / 20,2 y 6,3 / 7,4. Las 241, 258 y 261 peticiones terminaron `ok`, sin ningún corte.

Lectura honesta:
- El calendario de grupo baja a la mitad de forma repetida (fechas comunes en las dos mediciones; guardar días también).
- La disponibilidad del viaje hace el mismo trabajo que fechas comunes, pero la primera medición no mejoró y la segunda sí (6 / 7). Con 12 muestras por ventana, la variación entre mediciones (isolate, máquina) es del orden de lo que se mide. **No se da por resuelta**: se vuelve a medir con la siguiente ejecución de «v2 · medir CPU».
- Siguen por encima de 10 ms, sobre todo en la **primera petición** de una ventana (isolate frío): el catálogo público (1.ª 19–20 ms, p50 9–10 en las dos mediciones), crear un viaje (12–13 ms, una vez por viaje), el alta de perfil (9–10 ms, una vez por persona) y picos sueltos (gastos 14 ms, añadir artículos 19 ms) en una sola muestra. Ninguna petición se cortó.
- Margen: con 16 personas, las rutas de calendario repetidas quedan en 5–7 ms (30–50 % de margen frente a 10 ms); el catálogo público, que todo el mundo carga al entrar, es ahora la ruta con menos margen.

**Si quedan picos.** Workers Free corta una petición que pasa de 10 ms de CPU de forma sostenida (`exceededCpu`); tolera picos aislados. La vigilancia diaria marca un FALLO con cualquier `exceededCpu` en 24 h y avisa (AVISO) si el p99 pasa de 10 ms. Respuesta prevista sin coste: lanzar «v2 · medir CPU» para identificar la ruta, reducir el trabajo de esa ruta (menos filas o menos cálculo por petición) y, en el calendario, limitar el rango o las personas por consulta. No se contrata un plan de pago ni se desactivan controles.

### Medido en producción el 03/10/2026 (historial)

24 h tras la publicación (recuperación, run 37126210933): 236 peticiones, p50 2,9 ms, p99 16,3 ms. **Ninguna cortada por CPU**: todas `success`. Free tolera ráfagas por encima de 10 ms, pero no conviene depender de eso.

Sondeo por ruta (run 37136969820, commit 4b3b34a). CPU de la analítica en ms; n = peticiones de la ventana:

| Ruta | n | p50 | p99 / máx. | Nota |
|---|---|---|---|---|
| `POST /api/ingest/offers` (~190 ofertas por parte) | 5 | 15 | 31 | 4 de 5 por encima de 10 ms |
| `GET /api/availability/common` (2 personas × 150 días) | 5 | 12,9 | 18,5 | 4 de 5 por encima de 10 ms |
| `GET /api/trips/:id/expenses` | 5 | 5,3 | 21,9 | Solo la primera petición (isolate frío) |
| `GET /api/trips/:id/cost-comparison` | 5 | 5,3 | 17,5 | Idem |
| `POST /api/me` (alta) | 1 | 16,7 | 16,7 | Una vez por persona |
| `GET /api/trips/:id/comments` | 5 | 2,8 | 14,5 | Isolate frío |
| `GET /api/public/catalog` | 5 | 5,1 | 13,1 | Isolate frío |
| `GET /api/trips/:id/budget` | 5 | 6,5 | 11,9 | |
| `GET /api/availability/trip/:id` | 5 | 7,4 | 12,2 | Misma búsqueda de intervalos que `common` |
| `PUT /api/availability/me` (150 días) | 4 | 4,4 | 10,8 | |
| Resto (32 rutas medidas) | | ≤ 3,8 | ≤ 9,6 | |

La mayoría de los picos son la primera petición de una ventana, cuando el isolate arranca y compila. Las dos rutas con el p50 por encima de 10 ms eran problemas reales, y se han cambiado:

- **Fechas comunes** (`findCandidateWindows`, `dailyCounts`): recorrían cada intervalo día a día con aritmética de fechas sobre cadenas. Ahora calculan la lista de días una vez y usan sumas acumuladas por persona, con el mismo resultado (`calendar.test.ts` lo compara con la definición directa en calendarios pseudoaleatorios). En Node 22: 1,4 → 0,7 ms con 1 persona, 3,9 → 0,6 ms con 8 y 12,1 → 1,1 ms con 30.
- **Ingesta de ofertas**: el coste crece con las ofertas de la parte (dos SHA-256 y validación por oferta). El recolector las envía ahora en partes de 80 en lugar de 200: mismas ofertas, más POST.

Después, con los cambios publicados (run 37143655755, commit b0a0a04; 206 peticiones, todas `ok`, ninguna cortada):

| Ruta | Antes p50 / p99 | Después p50 / p99 | Por encima de 10 ms |
|---|---|---|---|
| `POST /api/ingest/offers` (partes de 80) | 15 / 31 | 7 / 15 | 2 de 11 (antes 4 de 5) |
| `GET /api/availability/common` | 12,9 / 18,5 | 9,5 / 16,9 | 1 de 5 (antes 4 de 5) |
| `GET /api/trips/:id/expenses` | 5,3 / 21,9 | 3,5 / 5,4 | 0 |
| `GET /api/trips/:id/cost-comparison` | 5,3 / 17,5 | 4,9 / 7,3 | 0 |
| `POST /api/me` (alta) | 16,7 | 4,1 / 7,9 | 0 |
| `GET /api/public/catalog` | 5,1 / 13,1 | 8,1 / 19,7 | 1 de 5 (isolate frío) |

Con 2 personas, la búsqueda de intervalos ya solo cuesta ~1 ms; el resto de `common` es leer y convertir las filas de D1, así que sigue rozando los 10 ms y la mejora crece con el número de personas. El catálogo sube en la primera petición de su ventana (arranque del isolate); varía de una medición a otra. Siguen existiendo picos aislados por encima de 10 ms, que Free tolera; la vigilancia diaria avisa si aparece algún `exceededCpu`.

Importación de la hoja (5.000 filas, un SHA-256 por fila): no medida en Cloudflare. Es una operación puntual de administración. Si superara los 10 ms de CPU, Cloudflare la cortaría sin escribir nada a medias (un solo batch); la solución gratuita es dividir el CSV.

### Filas de D1

El 15/10/2026, con tres sondeos de CPU completos, uno acotado, recorridos de producción, publicaciones e ingestas, la vigilancia contó 1.941.127 filas leídas en 24 h (run 38724014999, aviso aislado por encima de 1 M). Es la ventana acumulada de 24 h, no lo que lee una petición: las consultas y las filas por ruta están en «Catálogo público y lecturas de D1». Con los índices de la migración 0015, las cuatro consultas que leían el 81 % pasan a leer cientos de filas por ejecución.

Con las pruebas del 03/10/2026 (dos recorridos de producción, el sondeo y los recolectores), las filas leídas en 24 h fueron 1.097.029 de 5.000.000 (vigilancia, run 37138208453). La vigilancia avisa por encima del 20 %. Las escrituras fueron 38.259 de 100.000.

### Campana de avisos (consumo estimado)

La campana pide solo el recuento (`GET /notifications/unread`: sesión + un `COUNT` sobre el índice `notifications_user`, que lee únicamente las filas sin leer). Consulta cada 60 s **solo con la pestaña visible**, al volver a ella o recuperar el foco, al navegar y tras acciones propias; con la pestaña oculta no consulta nada.

Estimación para 20 personas con la web visible 2 h al día cada una: 20 × 120 = 2.400 peticiones/día (2,4 % de las 100.000 peticiones diarias de Workers Free) y unas 2 × 2.400 ≈ 4.800 sentencias. Las filas leídas son las del perfil más las sin leer (normalmente menos de 10): del orden de 25.000 filas/día, un 0,5 % de los 5 M. Con 8 h visibles al día serían 9.600 peticiones (9,6 %). No escribe nada.

## Qué queda pendiente en Free

- Disponibilidad del viaje con 16 personas: p50 10 → 3 ms y 0 de 28 por encima de 10 ms en una medición acotada (38746509017). Confirmar con las siguientes mediciones.
- Comprobar en las vigilancias de los próximos días que la ventana de 24 h de filas leídas baja tras la migración 0015.
- Seguir el p99 diario en la vigilancia: con pocas peticiones al día, un solo arranque en frío lo sube por encima de 10 ms.
