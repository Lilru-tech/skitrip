# Km esquiables de otros años: fuentes y comparador

Fecha: 19/11/2026. Petición de David: en la ficha de una estación («Estado actual»), elegir unas fechas y ver cuántos km esquiables había esos mismos días en otras temporadas. Reglas: 0 €, solo datos verificables, «Sin dato» donde falte, nada estimado.

## Qué datos hay

| Fuente | Cobertura | Uso |
|---|---|---|
| Partes capturados por SkiTrip v2 (`snow_observations`) | Desde octubre de 2026, cada día, todas las estaciones con fuente de nieve | Sí. Solo partes con **fecha publicada por la fuente** (`source_date`) igual al día, calidad `ok` y estado conocido. Con varias fuentes del mismo ámbito, la de menor `priority` (oficial antes que agregador) y, en ella, la última captura del día. |
| SkiTrip antiguo (`legacy_snow_observations`, Esquiades) | 21/12/2025 – 03/10/2026, 19 estaciones (toda la temporada 2025-26) | Sí, marcado «sin verificar». Fecha = día de captura del recolector antiguo. Un 0 puede ser un «-» convertido: se muestra «0 o sin dato» y no entra en la media. |
| Wayback Machine (copias archivadas de partes) | 2–9 días por temporada y página; muchas webs pintan los km con JavaScript y la copia no los guarda | No en esta versión (ver abajo). |
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

- API: `GET /api/public/areas/:id/km-history?desde=MM-DD&hasta=MM-DD` (hasta 31 días dentro de una temporada; puede cruzar el año, p. ej. 12-28 → 01-03). 3 sentencias D1 (índice nuevo `snow_obs_area_source_date`, migración 0025).
- Temporada de julio a junio. Se listan desde la primera con algún dato del área hasta la actual; la actual solo si alguno de los días ya ha llegado. El 29/02 solo existe en años bisiestos.
- Por temporada: media de los días con dato, días con dato sobre días del intervalo, mínimo y máximo. «Cerrada» (cierre confirmado o fuera de temporada según el parte) cuenta como 0 km. No se rellenan días ni se toman de otra fecha o estación.
- Interfaz: «Comparar con otros años» dentro de «Estado actual» de la ficha; fechas en la dirección (`kmdesde`, `kmhasta`); «Ver día a día» con la tabla y «Ver detalles» con fuentes y metodología.
- Lógica en `src/core/km-history.ts`; pruebas en `test/core/km-history.test.ts`, `test/worker/km-history.test.ts` y `test/e2e/km-compare.spec.ts`.
