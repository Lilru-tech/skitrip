# Km esquiables de otros años: fuentes y comparador

Fecha: 19/11/2026. Petición de David: en la ficha de una estación («Estado actual»), elegir unas fechas y ver cuántos km esquiables había esos mismos días en otras temporadas. Reglas: 0 €, solo datos verificables, «Sin dato» donde falte, nada estimado.

## Qué datos hay

| Fuente | Cobertura | Uso |
|---|---|---|
| Partes capturados por SkiTrip v2 (`snow_observations`) | Desde octubre de 2026, cada día, todas las estaciones con fuente de nieve | Sí. Solo partes con **fecha publicada por la fuente** (`source_date`) igual al día, calidad `ok` y estado conocido. Con varias fuentes del mismo ámbito, la de menor `priority` (oficial antes que agregador) y, en ella, la última captura del día. |
| SkiTrip antiguo (`legacy_snow_observations`, Esquiades) | 21/12/2025 – 03/10/2026, 19 estaciones (toda la temporada 2025-26) | Sí, marcado «sin verificar». Fecha = día de captura del recolector antiguo. Un 0 puede ser un «-» convertido: se muestra «0 o sin dato» y no entra en la media. |
| Wayback Machine (copias archivadas de partes) | 2–9 días por temporada y página; muchas webs pintan los km con JavaScript y la copia no los guarda | Sí, desde la decisión de David del 19/11/2026: días sueltos con enlace a la copia (`km_archive_observations`, migración 0027). |
| Skiinfo / OnTheSnow «historique» | Nevadas y grosor por temporada o mes, sin km abiertos | No sirve. |
| ICGC InfoGruixNEU | Grosor de nieve diario desde 1985 (Núria, Boí, Bonaigua…), sin km | No sirve para km. |
| Prensa (ATUDEM, Europa Press, Nevasport…) | Resúmenes de algún fin de semana, sumas de varias estaciones | No: esporádico y a menudo agregado. |
| Redes sociales de las estaciones | Partes diarios en imagen o texto | No: sin API gratuita y leerlas automáticamente va contra sus condiciones. |
| open-piste (datos abiertos de estaciones francesas) | Historia solo desde que empezó a recoger (diciembre–abril) | No aporta temporadas pasadas. |

### Comprobación de la Wayback Machine (19/11/2026)

Herramienta de solo lectura `tools/km-history-sources-check.mjs` y `tools/km-history-esquiades-probe.ts` (rama `research/km-history-sources`, workflow «v2 · comprobar fuentes de km históricos», ejecuciones 44499137977 y 44499595045). Días de temporada (noviembre–mayo) con al menos una copia válida:

- Esquiades, estado de pistas (todas las estaciones en una página): 2–5 días por temporada de 2015-16 a 2025-26. El analizador actual lee las copias de 2015-16 a 2019-20 y de 2024-25 en adelante (32–88 filas); las de 2019-12 a 2023-12 tienen otro formato (0 filas). Las copias antiguas no publican fecha de parte: solo hay la hora de la copia.
- Port del Comte `/pistes/`: 3–9 días por temporada desde 2021-22, km en el HTML.
- Grandvalira `estat-de-pistes`: 3 días en 2023-24 y 2024-25 (km en la cabecera).
- Formigal-Panticosa, Cerler, Pal Arinsal, Baqueira, Ax, Font-Romeu: 1–8 días por temporada, sin km en el HTML archivado.
- La Molina, Masella, Ordino Arcalís, Infonieve, Nevasport y Skiinfo: ninguna copia en esas direcciones.

Conclusión: no existe una fuente pública con los km abiertos día a día de temporadas anteriores. El archivo web solo podría añadir unos pocos días sueltos por temporada (sobre todo de Esquiades), siempre con enlace a la copia.

## Comparador

- API: `GET /api/public/areas/:id/km-history?desde=MM-DD&hasta=MM-DD` (hasta 31 días dentro de una temporada; puede cruzar el año, p. ej. 12-28 → 01-03). 3 sentencias D1 (índice nuevo `snow_obs_area_source_date`, migración 0026).
- Temporada de julio a junio. Se listan desde la primera con algún dato del área hasta la actual; la actual solo si alguno de los días ya ha llegado. El 29/02 solo existe en años bisiestos.
- Por temporada: media de los días con dato, días con dato sobre días del intervalo, mínimo y máximo. «Cerrada» (cierre confirmado o fuera de temporada según el parte) cuenta como 0 km. No se rellenan días ni se toman de otra fecha o estación.
- Interfaz: «Comparar con otros años» dentro de «Estado actual» de la ficha; fechas en la dirección (`kmdesde`, `kmhasta`); «Ver día a día» con la tabla y «Ver detalles» con fuentes y metodología.
- Lógica en `src/core/km-history.ts`; pruebas en `test/core/km-history.test.ts`, `test/worker/km-history.test.ts` y `test/e2e/km-compare.spec.ts`.

## Días archivados (decisión de David, 19/11/2026: «propios + días archivados»)

- Tabla `km_archive_observations` (migración 0027), separada de `snow_observations`: nunca cuenta como «último parte» ni entra en Comparar.
- Recolector `tools/collectors/km-archive.ts`, workflow manual «v2 · km archivados» (en seco por defecto; «guardar» envía a `POST /api/ingest/km-archive`, que ignora duplicados, áreas desconocidas y fechas no pasadas). Recorre las mismas fuentes de nieve que la captura diaria; para cada página, las copias HTTP 200 de noviembre a mayo del índice CDX, la más tardía de cada día primero, con 2 s de pausa. Cada copia se lee con el mismo adaptador que la página actual (Esquiades por alias exacto; webs oficiales con su adaptador). Lo que no se reconoce queda sin dato.
- Fecha: la publicada en el parte si es de los 3 días anteriores a la copia como mucho (`dateBasis = report`); sin fecha publicada, la de la copia en hora de Madrid, solo si la copia es de las 09:00 o más tarde (`dateBasis = copy`, marcada «†» en la interfaz).
- Mismo día con varias copias: oficial antes que agregador, fecha publicada antes que fecha de copia, y la copia más tardía. Preferencia entre procedencias: parte de v2 > copia archivada > SkiTrip antiguo.
- Las temporadas sin ningún dato para las fechas elegidas se agrupan en una sola línea «Sin dato en …».

Prueba en seco del 19/11/2026 (PR #48): 158 días-estación. Esquiades: 41 copias de temporada, 13 días con datos (2015-16 a 2019-20 y 2024-25 en adelante; las copias de diciembre de 2019 a diciembre de 2023 tienen otro formato y no se leen). Webs oficiales: Grandvalira 4 días, Ordino Arcalís 1, Formigal-Panticosa 1; Port del Comte, Cerler y Pal Arinsal sin ningún día legible; Pirineu365 sin copias. Las copias antiguas de Esquiades no traen el estado: con km abiertos (> 0) publicados se guarda como abierta; con 0 se descarta.
