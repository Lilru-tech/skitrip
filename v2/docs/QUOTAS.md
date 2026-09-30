# Consultas D1, CPU y cuotas en el plan Free

Fecha: 30/09/2026. Rama `rebuild/v2`. Límites consultados ese día en https://developers.cloudflare.com/d1/platform/limits/ y https://developers.cloudflare.com/workers/platform/limits/.

## Límites que condicionan el diseño

| Límite (Free) | Valor | Cómo se respeta |
|---|---|---|
| Consultas D1 por invocación del Worker | 50 | Cada sentencia cuenta, **también cada sentencia dentro de un `batch`** (un batch no reinicia el contador). El Worker envuelve D1 con un contador (`src/worker/d1budget.ts`) y corta a **40** con un 503 `query_budget` antes de llegar a 50. |
| Parámetros por sentencia | 100 | Las listas no se expanden en `?1, ?2, …`: se envían como un único parámetro JSON y se leen con `json_each` (`IN (SELECT value FROM json_each(?))`, `INSERT … SELECT … FROM json_each(?)`). |
| Longitud de la sentencia SQL | 100 KB | El SQL es fijo; los datos van en parámetros. |
| Fila o cadena | 2 MB | La parte más grande (500 filas de CSV, 200 ofertas) va por debajo de 200 KB. |
| CPU por petición del Worker | 10 ms | Ver «CPU» más abajo. |
| Filas leídas / escritas al día | 5 M / 100.000 | Uso previsto para 10–20 personas muy por debajo. |

No se recomienda ni se necesita el plan de pago: todas las rutas medidas quedan por debajo de 12 sentencias.

## Sentencias medidas por ruta

Medido con `test/worker/quota-audit.test.ts`, que ejecuta cada ruta con los volúmenes indicados contra D1 local (workerd). Se cuentan todas las sentencias de la petición: autenticación, límites de uso, lecturas, escrituras y cada sentencia de un batch. El test falla si alguna pasa de 40.

| Ruta | Sentencias (máx.) | Volumen |
|---|---|---|
| `PUT /trips/:id/expenses/:eid` | 11 | 8 beneficiarios |
| `GET /trips/:id/budget` | 10 | 150 artículos, 30 productos × 10 fechas |
| `POST /trips/:id/scenarios` | 9 | — |
| `GET /trips/:id/cost-comparison` | 9 | 20 candidaturas |
| `GET /public/areas/:id` | 9 | — |
| `POST /trips/:id/invitations` | 8 | — |
| `POST /trips/:id/shopping/items` | 8 | lista de 150 |
| `POST /trips/:id/expenses` | 7 | 8 beneficiarios |
| `GET /availability/trip/:id` | 6 | 8 miembros × 150 días |
| `GET /trips/:id/shopping` | 6 | 150 artículos, 30 productos × 10 fechas |
| `GET /public/catalog` | 6 | 24 áreas |
| `POST /trips` | 5 | — |
| `GET /trips/:id/expenses` | 5 | 40 gastos × 8 personas |
| `GET /trips/:id/shopping/basket` | 5 | 150 artículos, 30 productos × 10 fechas |
| `GET /trips/:id/scenarios` | 5 | 4 escenarios (máximo por viaje) |
| `GET /trips/:id` | 5 | 8 miembros |
| `GET /friends` | 5 | 7 amigos |
| `POST /trips/invitations/:id/accept` | 4 | — |
| `PUT /availability/shares` | 4 | 1 viaje |
| `GET /availability/common` | 4 | 8 miembros × 150 días |
| `POST /products`, `POST /prices`, `POST /trips/:id/candidates` | 4 | — |
| `PUT /availability/me` | 3 | temporada completa, 150 días |
| `GET /trips/:id/expenses/history`, `GET /products/:pid/prices`, `GET /trips/:id/candidates` | 3 | 40 gastos / 10 observaciones / 20 candidaturas |
| `GET /availability/me`, `GET /availability/visible`, `GET /products`, `GET /trips`, `GET /notifications` | 2 | — |
| `GET /me`, `GET /public/sources` | 1 | 48 fuentes |

Medidas con su propio test (el test fija el máximo):

| Ruta | Máximo comprobado | Volumen | Test |
|---|---|---|---|
| `POST /ingest/snow` | ≤ 8 (igual con 1 que con 29 fuentes) | catálogo real completo | `quotas.test.ts` |
| `POST /ingest/offers` | ≤ 14 | 19 páginas × 10 ofertas (190) | `quotas.test.ts` |
| `POST /prices/import/preview` | ≤ 10 | CSV de 500 filas | `review-fixes.test.ts` |
| `POST /prices/import/confirm` | ≤ 12 | CSV de 500 filas | `review-fixes.test.ts` |

Antes de esta revisión la ingesta hacía 54 consultas por POST, la importación CSV hacía 1–2 por fila (503 con 500 filas), el calendario una por día y la lista de escenarios dos por escenario.

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

## Qué queda pendiente en Free

- Medir el CPU real por ruta tras desplegar (métricas del panel de Workers).
- Comprobar en D1 remoto que los recuentos coinciden con los locales. El contador cuenta sentencias en el Worker, así que debería coincidir, pero no se ha ejecutado en remoto.
