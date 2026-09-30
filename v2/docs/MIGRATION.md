# Migración desde el SkiTrip legacy y vuelta atrás

Principio: **nada del sistema actual se apaga, borra ni sustituye hasta que la v2 esté verificada en producción con datos reales.** GitHub Pages, el workflow `update-data.yml`, Apps Script y las hojas de Google siguen como están durante toda la transición. Cada paso que toca producción requiere el visto bueno explícito de David.

## Qué se migra y cómo

| Origen | Destino | Herramienta | Estado |
|---|---|---|---|
| `data/resorts.json` (19 estaciones) | `areas` curadas (24 ámbitos: estaciones, sectores y dominios) | `data/catalog.json` + `tools/import-legacy.ts` | Probado en local |
| `data/open_km_history.json` (5.337 filas) | `legacy_snow_observations` con ámbito y anomalías | `tools/import-legacy.ts` | Probado en local |
| `data/hotel_price_history.json` (4.432 filas) | `legacy_hotel_observations` | `tools/import-legacy.ts` | Probado en local |
| Hoja de comentarios | `legacy_comments` (no publicados) | `tools/import-sheets.ts --kind comments` | Probado con plantilla; **falta la exportación real** |
| Hoja de disponibilidad | `legacy_availability` | `tools/import-sheets.ts --kind availability` | Probado con plantilla; **falta la exportación real** |
| Hoja de compra | `legacy_shopping_items` | `tools/import-sheets.ts --kind shopping` | Probado con plantilla; **falta la exportación real** |

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

## Exportar las hojas (sin tocarlas)

En cada hoja: Archivo › Descargar › Valores separados por comas (.csv). Guarda los ficheros en `v2/exports/sheets/` (ignorado por git: contienen nombres y comentarios). No hace falta permiso de edición ni cambiar el Apps Script. Columnas aceptadas: ver `docs/templates/sheets-*.csv`; el importador reconoce también cabeceras en español.

```bash
npx tsx tools/import-sheets.ts --kind availability --file exports/sheets/disponibilidad.csv --dry-run
# revisar exports/sheets-availability-report.json: recuentos, errores, avisos y duplicados
npx tsx tools/import-sheets.ts --kind availability --file exports/sheets/disponibilidad.csv --apply remote
```

Si hay errores de validación no se genera SQL. Reejecutar es seguro: cada fila tiene un hash y se ignora si ya existe.

## Plan de cambio

1. Despliegue de la v2 en `skitrip.<subdominio>.workers.dev` (ver `DEPLOY.md`). La web legacy sigue en GitHub Pages.
2. Copia inicial: `npx tsx tools/backup.ts export --remote` y `restore-test` (base vacía, sirve de línea base).
3. Importar el legacy (`import-legacy.ts --apply remote`) y las hojas exportadas. Comprobar recuentos contra los informes: 19 estaciones legacy, 5.337 filas de nieve, 4.432 hoteleras, y los de cada CSV.
4. Configurar los secretos de Actions y lanzar a mano `v2-snow` y `v2-offers`. Revisar el estado de fuentes: cuántas dan datos, cuáles fallan y por qué.
5. Periodo en paralelo (recomendado: al menos una semana de temporada): el grupo usa la v2 para el calendario y los viajes; la legacy sigue disponible.
6. Solo con el visto bueno de David, y por este orden: enlace desde la legacy a la v2; desactivar `update-data.yml`; más adelante, y solo si ya no se usan, dejar las hojas en solo lectura. **El Apps Script y las hojas no se borran.**

## Vuelta atrás

La v2 no modifica nada del sistema legacy, así que volver atrás es dejar de usarla:

- **App:** el grupo vuelve a la URL de GitHub Pages, que nunca se ha desactivado. Opcionalmente, `npx wrangler delete` retira el Worker (la D1 se conserva).
- **Datos de la v2:** antes de cualquier migración de esquema, `tools/backup.ts export --remote`. Para restaurar una copia en una base nueva: `wrangler d1 create skitrip-restore`, `wrangler d1 execute skitrip-restore --remote --file exports/backup-<fecha>/backup.sql`, y apuntar `database_id` a la nueva base. `restore-test` comprueba primero la copia en local (recuentos y hashes).
- **Recolectores:** desactivar `v2-snow.yml` / `v2-offers.yml` en Actions. Si se hubiera desactivado `update-data.yml`, volver a activarlo: sus datos siguen en el repositorio.
- **Una migración de D1 fallida:** si una migración falla, wrangler la revierte y no la marca como aplicada; las anteriores se quedan. Restaurar la copia previa si el fallo fue lógico.
