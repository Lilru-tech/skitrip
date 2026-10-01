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

### Disponibilidad legacy

La hoja solo guardaba los días marcados como ocupados. Se importan esos días con su valor original; los días que no aparecen siguen **sin indicar**, nunca libres. No se copian al calendario nuevo de nadie: cuando un administrador asigna un nombre a una cuenta, esa persona ve sus días antiguos como referencia de solo lectura (`GET /api/legacy/availability/mine`) y marca su disponibilidad en la v2.

## Exportar e importar las hojas (sin tocarlas)

1. En la hoja, para cada pestaña (comentarios, compra, disponibilidad): Archivo › Descargar › Valores separados por comas (.csv). Se descarga solo la pestaña activa. No hace falta permiso de edición ni tocar el Apps Script. Los pasos para encontrar la hoja a partir del Apps Script están en `ACCESOS.md`.
2. Guarda los CSV fuera del repositorio: contienen nombres y comentarios. Nunca van a GitHub ni a Pages.
3. En la web nueva, en Administración → «Importar la hoja antigua (CSV)», elige la pestaña y el archivo y pulsa **Previsualizar**. Verás:
   - filas válidas, errores con su línea, avisos y duplicadas;
   - en disponibilidad, el reparto ocupado/libre/quizá/sin equivalencia;
   - si el archivo ya se importó, y las primeras filas.
4. Pulsa **Importar**. Con errores, solo se importa si marcas «omitir solo las filas con errores». Repetir la importación no duplica: cada fila tiene un hash y el archivo se identifica por su SHA-256. Se guarda una copia íntegra del CSV en la base.
5. Debajo, asigna cada nombre de la hoja a su cuenta, solo si has confirmado con esa persona que es ella. Cada persona ve sus días antiguos en Calendario → «Hoja antigua» y decide cuáles incorpora. Los comentarios se publican uno a uno.

Columnas aceptadas: `docs/templates/sheets-*.csv`; también reconoce cabeceras en español. Alternativa por línea de comandos (mismos identificadores, idempotente con la vía web):

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
