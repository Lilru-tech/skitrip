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

No se recomienda ni se necesita el plan de pago: **las 125 rutas del Worker** quedan en 19 sentencias o menos con los volúmenes medidos (ver abajo qué no se ha medido).

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
| `GET /availability/trip/:id` | 6 | 8 miembros × 150 días |
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
| `GET /availability/me` | 2 | 150 días |
| `GET /availability/shares` | 2 | 1 viaje + amigos |
| `GET /availability/visible` | 2 | 8 miembros × 150 días |
| `GET /friends/search` | 2 | 46 cuentas |
| `GET /legacy/availability/mine` | 2 | 150 días |
| `GET /me/prefs` | 2 | — |
| `GET /notifications` | 2 | — |
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

## Ejecuciones de captura por partes

- Cada POST de ingesta admite como máximo 200 filas. Los recolectores (`tools/collectors/*.ts`) parten el lote con `chunkBy` y envían `part`/`parts` con recuentos por parte.
- La ejecución queda `running` hasta recibir todas las partes. El estado final se calcula con la suma de todas las partes y el número real de filas guardadas.
- Reenviar una parte es idempotente: no duplica recuentos ni convierte una ejecución válida en vacía o errónea (probado en `quotas.test.ts`).

## CPU (10 ms)

**No se ha medido en Cloudflare.** El entorno local no aplica el límite, y dentro de workerd el reloj no avanza durante el cálculo, así que no se puede medir allí. Microbenchmarks de la lógica pura en Node 22 en el entorno de desarrollo, orientativos:

| Cálculo | Tiempo medio |
|---|---|
| Ventanas comunes, 8 personas × 150 días | 2,6 ms |
| Evolución de cesta, 150 artículos × 300 observaciones | 1,1 ms |
| Análisis de CSV de 500 filas | 0,6 ms |
| Recuentos diarios, 8 × 150 | 0,4 ms |

Los hashes SHA-256 (ingesta y CSV) usan `crypto.subtle`, que es nativo. Queda pendiente medir el CPU real en Free con las métricas del Worker tras el primer despliegue. Si alguna ruta se acercara al límite, el primer candidato es `GET /availability/common` con muchos participantes.

Importación de la hoja (5.000 filas, un SHA-256 por fila): no medida en Cloudflare. Es una operación puntual de administración. Si superara los 10 ms de CPU, Cloudflare la cortaría sin escribir nada a medias (un solo batch); la solución gratuita es dividir el CSV.

## Qué queda pendiente en Free

- Medir el CPU real por ruta tras desplegar (métricas del panel de Workers).
- Comprobar en D1 remoto que los recuentos coinciden con los locales. El contador cuenta sentencias en el Worker, así que debería coincidir, pero no se ha ejecutado en remoto.
