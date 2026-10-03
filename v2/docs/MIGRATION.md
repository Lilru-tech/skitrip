# Migración desde el SkiTrip legacy y vuelta atrás

Principio: **nada del sistema actual se borra.** Decisión de David (01/10/2026): la v2 se publica en la misma URL, `https://lilru-tech.github.io/skitrip/`, sin redirección. El cambio consiste en pasar la fuente de GitHub Pages de la rama actual a «GitHub Actions». Volver atrás es devolverla a la rama. Los archivos de la web antigua siguen en el repositorio. El workflow `update-data.yml`, el Apps Script y las hojas de Google no se tocan; el workflow solo se desactiva (sin borrarlo) cuando los recolectores nuevos estén verificados.

## Qué se migra y cómo

| Origen | Destino | Herramienta | Estado |
|---|---|---|---|
| `data/resorts.json` (19 estaciones) | `areas` curadas (24 ámbitos: estaciones, sectores y dominios) | `data/catalog.json` + `tools/import-legacy.ts` | Probado en local |
| `data/open_km_history.json` (5.337 filas) | `legacy_snow_observations` con ámbito y anomalías | `tools/import-legacy.ts` | Probado en local |
| `data/hotel_price_history.json` (4.432 filas) | `legacy_hotel_observations` | `tools/import-legacy.ts` | Probado en local |
| Hoja de comentarios | `legacy_comments` (no publicados) | Administración → «Importar la hoja antigua», o `tools/import-sheets.ts --kind comments` | Probado con datos sintéticos (API y navegador); **falta la exportación real** |
| Hoja de disponibilidad | `legacy_availability` | Administración, o `tools/import-sheets.ts --kind availability` | Probado de punta a punta en navegador: subir, asignar e incorporar; **falta la exportación real** |
| Hoja de compra | `legacy_shopping_items` | Administración, o `tools/import-sheets.ts --kind shopping` | Probado con datos sintéticos; **falta la exportación real** |

Los históricos legacy se leen del commit remoto (`--ref origin/main`, por defecto), no de una copia local. Cada fichero queda registrado con SHA-256, bytes, recuento y una copia íntegra troceada en `legacy_raw_chunks`, así que el original se puede reconstruir desde la base.

Lo que el importador encontró en los datos del commit `d173625` (informe completo en `exports/legacy-import-report.json`, que se regenera con `--dry-run`):

- 3.397 ceros ambiguos en la serie de nieve (el scraper convertía «-» en 0): se conservan marcados, no como «cerrado».
- 281 filas de Astún y Candanchú idénticas (101 km): es el dominio conjunto y se asignan a él, no a cada estación.
- La serie «alp-2500» con total 71 km corresponde a La Molina; con 145 km, al conjunto Alp 2500.
- Las 4.432 observaciones hoteleras no tienen noches, hotel, fechas de estancia ni ocupación: sirven como referencia agregada, nunca como evolución del precio de una oferta concreta.
- La longitud de Astún tenía el signo cambiado (corregida en el catálogo) y hay rutas incoherentes (Sabadell→Astún más corta que la línea recta; Astún y Candanchú con distancias dispares), marcadas «por revisar».

### Identidades legacy

Los nombres de autor de las hojas no prueban identidad. Nada legacy se asocia a una cuenta automáticamente: un administrador lo hace de forma explícita (`POST /api/admin/legacy/comments/:id/reconcile` y `POST /api/admin/legacy/availability/reconcile`), queda auditado y los comentarios legacy no se publican solos.

### Compra legacy

Las filas de compra de la hoja (nombre, precio, cantidad y «por día», escritos a mano) se recuperan desde **Compra › Mis listas generales › Revisar la hoja antigua**: vista previa sin nombres de personas e importación idempotente a la lista general de cada persona (índice único por lista y fila; repetir no duplica). Se importan también las filas incompletas y la lista indica qué falta: producto exacto (sin él no hay historial de precios), cantidad no numérica, formato o precios registrados. El precio de la hoja se conserva como texto marcado «antiguo», sin fecha ni tienda: nunca se convierte en observación de precio ni se presenta como actual. «Por día» se multiplica por los días de esquí del viaje al copiar la lista (como hacía la hoja); si el viaje no los tiene, se copia la cantidad tal cual y se avisa. Sigue existiendo la recuperación directa a un viaje (`/trips/:id/shopping/legacy`).

### Disponibilidad legacy

La hoja solo guardaba los días marcados como ocupados. Se importan esos días con su valor original; los días que no aparecen siguen **sin indicar**, nunca libres. No se copian al calendario nuevo de nadie: cuando un administrador asigna un nombre a una cuenta, esa persona ve sus días antiguos como referencia de solo lectura (`GET /api/legacy/availability/mine`) y marca su disponibilidad en la v2.

### Incorporación guiada (Administración, 03/10/2026)

Arriba de Administración, «Hoja antigua: incorporación guiada» resume en tres cifras lo que hay y en qué punto está, sin decidir nada por ti:

- **Conservado:** todo lo importado (comentarios, días de disponibilidad, artículos de compra), con su copia original.
- **Pendiente de revisión:** comentarios sin publicar y nombres de la hoja sin vincular a una cuenta.
- **Incorporado:** comentarios publicados, días que alguien ha incorporado a su calendario y nombres vinculados.

Los pasos que siguen son explícitos y quedan auditados:

1. **Vincular nombres** («Nombres de la hoja»): cada nombre escrito en la hoja, con sus días y sus comentarios. Vincular uno a una cuenta (`POST /api/admin/legacy/identities/link`) asigna ambas cosas a esa persona y **no publica nada**. Si no hay certeza, se deja sin vincular.
2. **Revisar comentarios:** se marcan uno a uno y «Publicar los elegidos» (`POST /api/admin/legacy/comments/publish`) publica solo esos, sin tocar su vinculación. Los de ámbito `global` (consejos generales, no de una estación) se muestran en Comparar › «Consejos generales» (`GET /api/public/tips`); antes no aparecían en ningún sitio.
3. **Disponibilidad:** la hoja real cubre enero–marzo de 2026 (temporada 2025–26). Esos días son **consulta histórica**: la persona vinculada los ve en Calendario › Hoja antigua, resumidos por mes, pero no se ofrecen para incorporar y el servidor rechaza incorporar días anteriores a hoy (`skippedPast`). Nada se traslada a la temporada 2026–27.
4. **Compra:** se recupera desde la página Compra, artículo a artículo.

`GET /api/admin/legacy/summary` da las cifras del resumen. Todas estas rutas son solo de administración (rol comprobado en el servidor; para el resto responden 404).

## Revisión de rutas y km totales (03/10/2026)

`npx tsx tools/review-routes.ts` compara, sin red, las distancias del SkiTrip antiguo (`app.js`, `ROAD_DISTANCE_KM`) con las rutas del catálogo, la línea recta y los km totales del catálogo antiguo (`data/resorts.json`) con la serie antigua de nieve (`data/open_km_history.json`). No valida nada.

**Procedencia de las rutas.** La interfaz distingue tres niveles y no los infla: *estimación heredada* (`legacy_hardcode`, sin fuente ni fecha: Port Ainé desde Tarragona y Vall de Núria desde ambos orígenes), *calculada* con fuente y fecha (OSRM del 01/10/2026, `validated = 0`, el resto) y *revisada por una persona* (`validated = 1`, ninguna todavía). El importador sigue escribiendo `validated = 0`. Todas las rutas OSRM van al **punto aproximado de la estación en el catálogo**, no a un acceso o aparcamiento confirmado, y así se indica.

**Accesos por confirmar** (no se pueden comprobar desde aquí): Vall de Núria no tiene acceso por carretera (cremallera desde Ribes de Freser o Queralbs); Formigal-Panticosa usa un punto entre las dos estaciones que OSRM ajustó a 2,9 km del lado de Formigal; el resto, el punto del catálogo («coordenadas aproximadas» en Masella, Formigal y Panticosa).

**Diferencias de 40 km o más entre la distancia heredada y OSRM:**

| Origen | Estación | Heredada | OSRM | Diferencia |
|---|---|---|---|---|
| Tarragona | Candanchú | 405 | 298 | −107 (la heredada tampoco cuadra con Astún, 315, a 3 km) |
| Tarragona | Grandvalira | 260 | 211 | −49 |
| Tarragona | Pal Arinsal | 250 | 202 | −48 |
| Tarragona | Ax 3 Domaines | 310 | 262 | −48 |
| Tarragona | Ordino Arcalís | 255 | 215 | −40 |
| Sabadell | Formigal-Panticosa | 280 | 416 | +136 (desde Tarragona, 370: revisar el punto de destino) |
| Sabadell | Boí Taüll | 190 | 293 | +103 |
| Sabadell | Astún | 250 | 350 | +100 |
| Sabadell | Cerler | 225 | 294 | +69 |
| Sabadell | Port Ainé | 165 | 233 | +68 |
| Sabadell | Baqueira Beret | 210 | 277 | +67 |
| Sabadell | Espot Esquí | 190 | 242 | +52 |

Varias heredadas desde Sabadell son apenas 1,3 veces la línea recta por los valles del Pirineo (p. ej. Boí Taüll: 190 km frente a 145 en línea recta), lo que apunta a que eran optimistas; pero una persona debe revisarlas antes de marcar ninguna como revisada. `validateRoutes` no da avisos con las rutas actuales.

**Km totales del catálogo antiguo que no coinciden con la serie de nieve antigua** (Esquiades, 285 lecturas del 21/12/2025 al 03/10/2026). Se conservan los del catálogo, marcados «sin verificar», con una nota visible en la ficha:

| Estación | Catálogo antiguo | Serie antigua | Fuente actual |
|---|---|---|---|
| Baqueira Beret | 166 | 173 | sin lectura oficial de km |
| Port Ainé | 32 | 27 | sin lectura oficial de km |
| Port del Comte | 50 | 42 (277) / 40 (6) | la web oficial no publica km (31 pistas) |
| Astún | 50 | 101 | 101 es la serie conjunta Astún-Candanchú |
| Alp 2500 | 145 | 71 (275) / 145 (10) | 71 es La Molina (ya reasignado) |

Grandvalira es el único total confirmado con una fuente oficial leída (215 km en el parte real del 30/09/2026). Ordino Arcalís y Pal Arinsal no publican km en su web: sus 30 y 63 km siguen sin verificar.

## Exportar e importar las hojas (sin tocarlas)

1. En la hoja, para cada pestaña (comentarios, compra, disponibilidad): Archivo › Descargar › Valores separados por comas (.csv). Se descarga solo la pestaña activa. No hace falta permiso de edición ni tocar el Apps Script. Los pasos para encontrar la hoja a partir del Apps Script están en `ACCESOS.md`.
2. Guarda los CSV fuera del repositorio: contienen nombres y comentarios. Nunca van a GitHub ni a Pages.
3. En la web nueva, en Administración → «Importar la hoja antigua (CSV)», elige la pestaña y el archivo y pulsa **Previsualizar**. Verás:
   - filas válidas, errores con su línea, avisos y duplicadas;
   - en disponibilidad, el reparto ocupado/libre/quizá/sin equivalencia;
   - si el archivo ya se importó, y las primeras filas.
4. Pulsa **Importar**. Con errores, solo se importa si marcas «omitir solo las filas con errores». Repetir la importación no duplica: cada fila tiene un hash y el archivo se identifica por su SHA-256. Se guarda una copia íntegra del CSV en la base.
5. En «Nombres de la hoja», vincula cada nombre a su cuenta, solo si has confirmado con esa persona que es ella. Cada persona ve sus días antiguos en Calendario → «Hoja antigua»: los futuros los puede incorporar; los pasados son solo consulta. Los comentarios se publican eligiéndolos uno a uno.

Columnas aceptadas: `docs/templates/sheets-*.csv` (también se descargan desde Administración › «Plantillas CSV y ayuda»), con cabeceras en español o en inglés. La estación de un comentario se escribe por su nombre, como aparece en Comparar, o «general» para un consejo del viaje: no hace falta conocer ningún identificador interno. Alternativa por línea de comandos (mismos identificadores, idempotente con la vía web):

```bash
npx tsx tools/import-sheets.ts --kind availability --file ~/skitrip-csv/disponibilidad.csv --dry-run
npx tsx tools/import-sheets.ts --kind availability --file ~/skitrip-csv/disponibilidad.csv --apply remote
```

## Plan de cambio

El procedimiento con comprobaciones está en `DEPLOY.md` («Procedimiento de publicación»). En resumen:

1. Desplegar la API y la D1 desde Actions. Importa el catálogo y los históricos (19 estaciones legacy, 5.337 filas de nieve, 4.432 hoteleras); los totales salen en el resumen del workflow.
2. Cambiar la fuente de Pages a «GitHub Actions» y publicar. La URL es la misma.
3. Darse de alta, dar el rol de administración por UID y importar las hojas.
4. Comprobar las fuentes online, lanzar los recolectores y, cuando den datos, desactivar `update-data.yml` (sin borrarlo).
5. **El Apps Script y las hojas no se borran ni se modifican.** Dejarlas en solo lectura es una decisión posterior de David.

## Vuelta atrás

- **Interfaz:** Settings → Pages → Source → «Deploy from a branch» con la rama y carpeta de antes. La web antigua vuelve a la misma URL; sus archivos nunca se han movido.
- **API:** `npx wrangler rollback` vuelve a la versión anterior del Worker. Retirarlo del todo (`npx wrangler delete`) no borra la D1.
- **Datos de la v2:** D1 Time Travel restaura cualquier minuto de los últimos 7 días (`npx wrangler d1 time-travel restore skitrip --bookmark=<marcador>`). El despliegue anota el marcador anterior a cada migración. Para guardar una copia más larga, `tools/backup.ts export --remote` y `restore-test`, siempre fuera del repositorio.
- **Recolectores:** desactivar `v2-snow.yml` y `v2-offers.yml` en Actions, y volver a activar `update-data.yml` si se había desactivado. Sus datos siguen en el repositorio.
- **Una migración de D1 fallida:** wrangler la revierte y no la marca como aplicada; las anteriores se quedan. Si el fallo fue lógico, se restaura el marcador de Time Travel.
