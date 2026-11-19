# Afluencia histórica, previsión y clima habitual: cobertura real y propuesta

Investigación del 18/11/2026, antes de implementar. Lo marcado **(comprobado)** se ha consultado en el servicio real
desde GitHub Actions con `tools/weather-sources-check.ts` (workflow «v2 · comprobar fuentes meteo y afluencia», runs
44393298393 y 44393674225, solo lectura, sin claves). Lo marcado **(documentación)** solo se ha leído en la web del
proveedor. Lo marcado **(sin comprobar)** es una pista pendiente. El contenedor de desarrollo no llega a estas APIs.

Tres tipos de información que no se mezclan:

| Tipo | Qué es | De dónde | Qué no es |
|---|---|---|---|
| Parte actual | Apertura, km, pistas y nieve comunicados por la estación | Lo existente (`snow_observations`) | No es previsión ni clima |
| Previsión | Salida de modelos numéricos para fechas concretas | Open-Meteo (modelos ECMWF, DWD, Météo-France) | No es observación; la nieve nueva prevista no es espesor en pistas, calidad, apertura ni seguridad |
| Clima habitual | Resumen de años anteriores en la misma época (±7 días) | Reanálisis ERA5 («Histórico reconstruido») y, aparte, estaciones medidas | No dice qué tiempo hará en el viaje |

## 1. Afluencia histórica

### Fuentes revisadas

| Fuente | Qué publica | Unidad y ámbito | ¿Diario por estación? |
|---|---|---|---|
| [Pirineu365, 16/03/2026](https://pirineu365.cat/es/noticia/las-estaciones-de-pirineu365-baten-records-historicos-de-nieve-y-visitantes/) (documentación) | Récords de la temporada 2025-26 | «esquiadores» por día: La Molina 15/02 **8.564**; Boí Taüll 21/02 **4.123**; Port Ainé 21/02 **3.368**. Grupo FGC: 21/02 22.585 y 22/02 20.096 «personas»; récord anterior 20.276 (2023, sin fecha) | Sí, pero solo días récord (muestra seleccionada). Las cifras de grupo no se atribuyen a ninguna estación |
| [Aramón, balance 2025-26](https://www.aramon.com/blog/grupo-aramon-balance-temporada/) (documentación) | 1.248.000 «días de esquí» de todo el grupo en la temporada | Días de esquí vendidos, grupo, temporada | No. Balance anual de grupo: no se reparte entre estaciones ni días |
| [Datos abiertos FGC](https://fgc.opendatasoft.com/) (comprobado) | 49 conjuntos: estado de servicios por estación, pistas, remontes, aparcamientos, `demanda-mensual-per-estacio-2019-2024` (estaciones de tren, mensual), `meteo-tim` | Ninguno de afluencia de esquiadores | No. Además su `robots.txt` excluye `/api/` para robots: no se usa en producción |
| Grandvalira / Ski Andorra (noticias alto.ad, Vozpópuli) (documentación) | 46.800 días de esquí en el puente de la Purísima; 336.000 en Navidad; 2,38 M en la temporada | Días de esquí, varios días o temporada, dominio o grupo | No. Totales de varios días: no se reparten |
| Nevasport / ATUDEM (documentación) | Rankings de días de esquí por temporada | Temporada | No |

**Conclusión.** No existe ninguna fuente gratuita y abierta con afluencia diaria por estación. Solo hay observaciones
sueltas en noticias de récords o de puentes.

### Segunda revisión (19/11/2026) y cambio

Con la sección casi siempre en «Sin dato», se revisaron más fuentes:

| Fuente | Qué hay | ¿Sirve? |
|---|---|---|
| Prensa (Nevasport, Pirineu365, Aramón, Grandvalira, Masella, Baqueira) | Récords sueltos, totales de puentes y de temporada | No: muestra seleccionada, sin serie diaria |
| [Estadística del flujo de vehículos de Andorra](https://www.altaveu.com/uploads/s1/25/35/74/4/a118-20260625-a.pdf) (Departament d'Estadística, A118) | Entradas por frontera, **mensuales** | No: ni diario ni por estación |
| Datos abiertos de FGC, aforos de tráfico (Idescat, Servei Català de Trànsit) | Sin esquiadores; tráfico anual o mensual | No |
| «Horas punta» de Google Maps | Sin API oficial; los servicios que la revenden (p. ej. [BestTime](https://besttime.app/subscription/pricing), desde 29 $/mes) son de pago y rascar Google incumple sus condiciones | No (coste y condiciones) |
| Apps y redes de las estaciones | No publican la cifra del día de forma regular | No |
| [OpenHolidays API](https://www.openholidaysapi.org/) ([datos ODbL 1.0](https://github.com/openpotato/openholidaysapi.data)) | Festivos y vacaciones escolares oficiales de España por comunidad, Francia por zona y Andorra | **Sí**: gratuito, abierto y verificable |

**Decisión (David, 19/11/2026): se quita la afluencia y se muestra qué festivos y vacaciones escolares coinciden con las
fechas.** No es una cifra de gente, y se dice así. Calendarios: Cataluña, Aragón, Madrid, Comunidad Valenciana, País
Vasco, Navarra, Francia zonas A, B y C, y Andorra (`src/core/holidays.ts`). Reglas:

- Festivo nacional o de la comunidad: cuenta para todo el calendario. Uno de solo algunas provincias o academias se
  muestra como «solo en parte» y no cuenta como fiesta del calendario entero. No incluye fiestas locales.
- Un día sin calendario publicado (OpenHolidays aún no tiene ese curso o ese año) es «sin calendario», nunca «sin
  fiesta». Un calendario cubre un día si tiene algún periodo de todo su territorio que acaba ese día o después.
- Lo descarga cada lunes el workflow «v2 · festivos y vacaciones» (`tools/holidays-sync.ts`, 6 peticiones) desde hace un
  año hasta dentro de unos 23 meses y lo envía a la ingesta, que sustituye los periodos de esa ventana. Si un país no
  devuelve nada o algún calendario se queda sin festivos o sin vacaciones, no envía nada.
- **Hueco de OpenHolidays (19/11/2026):** no tiene las vacaciones escolares del curso 2026-27 de ninguna comunidad
  española (Francia y Andorra sí). Mientras falten, se añaden a mano desde `data/school-holidays-es.json`, solo para
  el calendario y curso que OpenHolidays no trae; cuando lo publique, manda lo suyo. Fuentes del curso 2026-27:

  | Comunidad | Navidad | Semana Santa | Fuente |
  |---|---|---|---|
  | Cataluña | 22/12–07/01 | 20/03–29/03 | [Ordre EDF/66/2026 (DOGC 9653)](https://educacio.paeria.cat/ca/escolaritzacio/copy_of_calendari-escolar/ordre-edf662026-de-22-dabril-per-la-qual-sestableix-el-calendari-escolar-dels-cursos-2026-2027-2027-2028-2028-2029.pdf) |
  | Aragón | 23/12–06/01 | 25/03–02/04 | [zaragozala.com](https://zaragozala.com/actualidad/calendario-escolar-zaragoza-2026-2027/) (prensa) |
  | Madrid | 23/12–10/01 (y semana blanca 12 y 15/02) | 19/03–29/03 | [elDiario.es](https://www.eldiario.es/madrid/somos/calendario-escolar-2026-2027-madrid-curso-puentes-inicio-final-adelantado_1_13322933.html) (prensa) |
  | C. Valenciana | 22/12–06/01 | 25/03–05/04 | [El Debate](https://www.eldebate.com/espana/comunidad-valenciana/20260612/curso-escolar-20262027-empezara-9-septiembre-acabara-18-junio-comunidad-valenciana_428112.html) (prensa) |
  | País Vasco | 24/12–06/01 (mínimo) | 25/03–29/03 (mínimo) | [Resolución de Infantil y Primaria](https://www.euskadi.eus/contenidos/informacion/cee_organizacioncentros_calend/es_def/adjuntos/2026_2027/Resolucion-calendario-Primaria-2026_27-cast-.pdf) |
  | Navarra | 23/12–10/01 | 25/03–04/04 | [Blog de Euskaltel](https://blog.euskaltel.com/calendario-escolar-navarra/) (prensa) |

  Cuatro vienen de prensa que cita el calendario de la comunidad; si aparece la orden oficial, se cambia la fuente.
- Los festivos son los mismos para todas las estaciones, así que no puntúan en Comparar: el peso «Afluencia histórica»
  desaparece. Las tablas de la migración 0022, con sus 3 observaciones, se conservan sin uso.

## 2. Previsión para las fechas del viaje

### Proveedores evaluados

| Candidato | Resultado | Decisión |
|---|---|---|
| [Open-Meteo Forecast](https://open-meteo.com/en/docs) (comprobado) | Sin clave. Varios modelos identificados en una petición. Variables horarias: `temperature_2m` °C, `precipitation`/`rain` mm, `snowfall` cm (de la hora anterior), `wind_speed_10m`/`wind_gusts_10m` km/h. Metadatos de cada modelo con hora de pasada y de disponibilidad (`/data/<modelo>/static/meta.json`) | **Elegido** |
| [Open-Meteo Ensemble](https://open-meteo.com/en/docs/ensemble-api) (comprobado: 51 miembros ECMWF) | Útil para dispersión, pero sus frecuencias no son probabilidades calibradas | No en esta versión |
| [AEMET predicción de montaña](https://www.aemet.es/es/eltiempo/prediccion/montana) / [OpenData](https://opendata.aemet.es/dist/) (documentación) | Predicción de montaña en texto por macizo (Pirineo catalán, aragonés, navarro); OpenData exige clave por correo; su `robots.txt` impide leerla desde aquí | No: no da valores numéricos por punto comparables; enlace informativo como mucho |
| [Meteocat](https://www.meteo.cat/wpweb/serveis/dades-obertes/) (documentación) | Predicción por comarca y del Pirineo en XML/JSON, texto y símbolos; la API completa pide clave | No para la previsión numérica |
| [Météo-France portail API](https://portail-api.meteofrance.fr/) (documentación) | AROME/ARPEGE con cuenta y clave | No: son los mismos modelos que Open-Meteo ya redistribuye; no serían confirmaciones independientes |

Open-Meteo plan libre (documentación, [pricing](https://open-meteo.com/en/pricing)): solo uso **no comercial**
(SkiTrip es privado y sin ingresos), 600 llamadas/min, 5.000/h, 10.000/día, 300.000/mes; una petición con más de 10
variables o más de 2 semanas cuenta como varias llamadas (fraccionario). Datos CC BY 4.0: atribución obligatoria
(«Datos meteorológicos: Open-Meteo.com, CC BY 4.0» y el modelo de origen) e indicar modificaciones (agregados diarios).
Las condiciones no prohíben guardar resultados. Riesgo: el límite es por IP y el Worker sale por IPs compartidas de
Cloudflare; un 429 se muestra como «previsión no disponible ahora», nunca se cambia a un servicio de pago.

### Modelos (comprobado el 18/11/2026 en la Tosa d'Alp)

| Modelo (id) | Horizonte real observado | Resolución temporal | Altitud de la celda* | Notas |
|---|---|---|---|---|
| ECMWF IFS HRES 9 km (`ecmwf_ifs`) | 15 días (hasta el 03/12, 384 h pedidas, 374 con dato) | horaria hasta 90 h, luego 3 h y 6 h interpoladas | 1.404 m | Pasada cada 6 h |
| DWD ICON (`icon_seamless`: ICON-EU 7 km → global 11 km) | ~7,5 días | horaria | 1.682 m | Pasada cada 3–6 h |
| Météo-France (`meteofrance_seamless`: AROME 2,5/1,3 km → ARPEGE 11 km) | ~4 días | horaria | 2.108 m | AROME HD sin lluvia/nieve separadas: se usa el «seamless» |
| NCEP GFS (`gfs_seamless`) | 16 días | horaria | 1.505 m | Reserva; no se usa por defecto |

\* Con `elevation=nan` (celda del modelo sin ajustar). El punto de prueba (estación XEMA de la Tosa d'Alp) está a 2.478 m.

**Efecto del parámetro `elevation` (comprobado, 3 días, mismo punto):** al pedir 2.478 m, Open-Meteo baja la
temperatura media (ECMWF 6,65 → −0,39 °C; ICON 6,14 → 0,94; Météo-France 1,95 → −0,45) y, en ECMWF y Météo-France,
también cambian precipitación y rachas (ECMWF lluvia 9,2 → 11,8 mm, racha máx. 52,9 → 41,0 km/h), lo que indica que
además elige otra celda vecina más parecida en altitud. En ICON solo cambia la temperatura. Decisión: ver el final del documento.

### Política de horizonte

- Días contados en Europe/Madrid desde hoy (D0).
- **Previsión próxima**: D0–D3. Se muestran los modelos con dato (normalmente los tres).
- **Tendencia**: D4–D7. Solo ECMWF e ICON; se rotula «tendencia», por días, sin franja horaria.
- **Más allá de D7**: «Todavía no hay previsión disponible» (aunque ECMWF y GFS lleguen a 15–16 días, no se añade un
  pronóstico diario tan lejano). Se ofrece el clima habitual por separado.
- Un día cuenta como cubierto por un modelo solo si tiene las 24 horas locales de ese día. Si el viaje está cubierto en
  parte, se listan los días cubiertos y no se da un acumulado del viaje.
- Caducidad: la previsión guardada vale 3 h desde la descarga; además se muestra la hora de la pasada de cada modelo
  y su antelación («pasada de las 12 UTC, hace 7 h»). Pasadas 12 h sin poder refrescar: «previsión antigua», no puntúa.
- Sin porcentajes de fiabilidad por días restantes, y el acuerdo entre modelos no se presenta como probabilidad.

### Puntos meteorológicos

Un punto por estación (no por dominio: el dominio muestra los de sus estaciones), dentro del área esquiable, con
coordenadas, altitud y fuente documentadas en `data/weather-points.json`. No se reutilizan los puntos de llegada por
carretera (Queralbs no representa Núria; Sextas no representa las pistas de Formigal). Cuando hay una estación XEMA en
las pistas, su posición sirve de punto. Las celdas de los modelos tienen 1,3–11 km y una altitud media que puede estar
cientos de metros por debajo de las pistas: se muestra siempre la altitud del punto y la de la celda de cada modelo.
No se inventan correcciones de nieve o viento entre cotas.

### Qué se muestra

Por día y por modelo, en la franja de esquí **09:00–17:00 hora local (Europe/Madrid)** y en el día completo:
temperatura mín./máx. (°C), lluvia (mm, suma), nieve nueva (cm, suma; la «nieve» de los modelos es la caída prevista,
no el espesor), racha máxima (km/h) y horas con racha ≥ 60 km/h. Las diferencias entre modelos se muestran tal cual
(mín.–máx. entre modelos), sin promediarlas. Si solo responde un modelo, se dice. Ausente, antiguo y 0 son distintos.

## 3. Clima habitual (±7 días)

### Fuentes

| Fuente | Cobertura | Variables | Decisión |
|---|---|---|---|
| ERA5 vía [Open-Meteo Historical](https://open-meteo.com/en/docs/historical-weather-api) (comprobado) | Todas las estaciones; 1940 → hoy −5 días; celda 0,25° (en La Molina 1.324 m) | temp. máx./mín., precipitación, lluvia, nieve (cm), viento y rachas | **Elegido** como «Histórico reconstruido» |
| ERA5-Land (comprobado) | 0,1°, 1.354 m en La Molina | Solo temperatura con dato en la prueba (precipitación, nieve y viento nulos) | No: incompleto |
| CERRA (comprobado) | 5,5 km | Todo nulo en la prueba (2025: fuera de su periodo, acaba en 2021) | No |
| ECMWF IFS histórico (comprobado) | 9 km desde 2017 | Temperatura nula en la prueba | No |
| XEMA Meteocat, [datos diarios](https://analisi.transparenciacatalunya.cat/) `7bvh-jvq2` (comprobado) | Estaciones medidas en o junto a las pistas (tabla siguiente) | En la Tosa d'Alp: temperatura y rachas (m/s), **sin precipitación** | **Fase 2**: serie «Medición» separada, nunca mezclada con ERA5 |
| Servei Meteorològic Nacional d'Andorra, [climatología](https://meteo.ad/es/climatologia) (documentación) | Estaciones en Arcalís, Arinsal, Envalira, Grau Roig, Soldeu; pide citar «Servei Meteorològic Nacional»; base de datos «en validación» | Sin confirmar | Pendiente de comprobar formato y licencia |
| AEMET OpenData (sin comprobar) | Posibles estaciones automáticas en Aragón | Requiere clave | Pendiente |

Estaciones XEMA candidatas (comprobado: metadatos `yqwd-vj5e` y cobertura de datos diarios):

| Estación del catálogo | Estación XEMA | Altitud | Datos diarios |
|---|---|---|---|
| La Molina, Masella | ZD la Tosa d'Alp | 2.478 m | 2014-09 → hoy |
| Vall de Núria | DG Núria | 1.971 m | 1998-05 → hoy |
| Boí Taüll | Z2 Boí | 2.537 m | 1998-11 → hoy |
| Espot Esquí | Z7 Espot | 2.519 m | 2002-03 → hoy |
| Baqueira Beret (sector Bonaigua) | Z1 Bonaigua | 2.262 m | 1997-11 → hoy |
| Port del Comte | ZE (2.288 m, desde 2023-09) y Z8 (2.316 m, 2002–2024, desmantelada) | | Dos estaciones distintas: no se empalman |

Licencia XEMA: el portal indica «See Terms of Use» con atribución a «Servei Meteorològic de Catalunya (METEO.CAT)» y
remite a las licencias de datos abiertos de la Generalitat (cuyo texto no se puede leer desde aquí): se cita la fuente.

### Metodología

- Periodo común: **1996–2025 (30 años)**, el más reciente con 30 años completos en ERA5. No es la normal climatológica
  oficial (OMM 1991–2020) y no se llama así: se elige reciente para reflejar el clima actual con un tamaño de muestra
  suficiente.
- Ventana: la fecha elegida y 7 días antes y después en cada año anterior (15 días). Con un intervalo de viaje, una
  sola ventana de «inicio −7» a «fin +7»: no se suman ventanas solapadas ni se cuentan como muestras independientes.
- Años y cruces de año: la ventana se calcula sobre fechas reales de cada año (el 28/12 ±7 cruza al año siguiente). El
  29/02 se usa solo en años bisiestos; en los demás la ventana del 29/02 es la del 28/02 al 1/03 ±7 sin inventar el día.
- Día meteorológico: día civil en Europe/Madrid (Open-Meteo agrega 24 h con desfase fijo; el cambio de hora de marzo y
  octubre se documenta como limitación de ±1 h).
- Resumen: mediana y percentiles 10–90 de temperatura máx./mín.; mediana de precipitación diaria; frecuencia de días
  con precipitación ≥ 1 mm, con nieve nueva ≥ 1 cm y con racha ≥ 60 km/h, como «X de Y días válidos (Z años)». Nunca
  «probabilidad». Un día sin dato no cuenta en el denominador ni se rellena con 0.
- Nieve: la de ERA5 es nieve caída en cm calculada por el modelo; no se deduce de lluvia y temperatura, ni se confunde
  con equivalente en agua o espesor.
- Preparación: un workflow manual descarga **una vez** por punto la temporada (20/10 → 10/05) de cada año de 1996 a
  2025 y la guarda compacta en D1 (una fila por punto y año). La ficha lee esas filas; nunca se descargan décadas al
  abrir una ficha.

## 4. Puntuación opcional (propuesta; se implementa después de tu visto bueno)

Dos pesos nuevos en Comparar, **«Afluencia histórica»** (retirado el 19/11/2026, ver §1) y **«Condiciones meteorológicas»**, ambos a 0. Con los dos a 0 la
clasificación es exactamente la actual (se comprueba con tests sobre `scoreRows`). Los pesos se conservan aunque el
criterio no pueda aplicarse.

**Condiciones meteorológicas** (solo con un viaje elegido con fechas):
- Se aplica solo si **todos** los días de esquí del viaje están en D0–D3, todas las estaciones comparadas tienen
  previsión vigente (< 12 h) de los mismos modelos para esos días, y al menos 2 modelos cubren cada día. Si no, el
  criterio queda inactivo para todas y se dice el motivo («el viaje empieza en 9 días»); nunca se trata la falta de
  previsión como buen tiempo ni se usa el clima habitual en su lugar.
- Por estación, día y modelo, en 09:00–17:00 hora local: `lluvia = min(1, mm de lluvia / 10)` y
  `viento = horas con racha ≥ 60 km/h / 9`. Índice desfavorable del día = `0,5 · lluvia + 0,5 · viento`.
- Desacuerdo entre modelos: se toma el **más desfavorable** (prudente y sin promediar); se muestra el rango.
- Varios días: media de los días de esquí. Puntos = `1 − índice` (escala absoluta, no min–max, para no exagerar
  diferencias pequeñas). La nieve nueva y la temperatura no puntúan; 60 km/h y 10 mm son umbrales de SkiTrip, no
  límites oficiales de seguridad ni de cierre de remontes.

**Afluencia histórica** (retirada el 19/11/2026): métrica = mediana de la intensidad diaria (esquiadores del día por km abierto) del mismo día y
mes en ≥ 3 años, sin muestras de récord, para todas las estaciones comparadas. Con los datos actuales **queda inactiva**
(ninguna estación cumple) y se explica qué falta. Menos visitantes absolutos o la falta de registros nunca dan ventaja.

## 5. Presupuesto de consumo (0 €)

| Recurso | Uso previsto | Límite gratuito |
|---|---|---|
| Open-Meteo previsión | 21 puntos × 3 modelos × 6 variables horarias × 8 días ≈ 1,8 unidades por punto. Caché compartida de 3 h por punto en D1 y una sola descarga simultánea por punto. Peor caso: 21 × 8 refrescos/día × 1,8 ≈ **300 unidades/día**. Tope propio 2.000/día | 10.000/día |
| Open-Meteo histórico | Preparación única: 21 puntos × 30 años × ~203 días (≈14,5 unidades) ≈ **9.100 unidades**, repartidas en 3 ejecuciones de ≤ 3.500 y reanudables | 10.000/día |
| D1 filas escritas | Previsión: ≤ 21 × 8 = 168/día. Histórico: 630 filas una vez. Festivos: ~650 filas por semana | 100.000/día |
| D1 filas leídas | Ficha: 1 (previsión) + 30 (clima) + ~650 (festivos: se lee la tabla para saber hasta cuándo hay calendario). Comparar: 1 por estación | 5 M/día |
| D1 almacenamiento | Clima ≈ 630 filas × ~8 KB ≈ 5 MB | 5 GB |
| Worker CPU | Una previsión de un punto ≈ 30 KB JSON; la agregación diaria se guarda ya hecha | 10 ms |
| GitHub Actions | Un workflow de preparación del clima (programado 2 veces al día, reanudable), festivos (semanal) y la comprobación de fuentes | Repositorio público |

## 6. Orden de las PR

1. Esta PR: documentación y comprobación externa de solo lectura.
2. Afluencia: migración (observaciones + historial), API pública y de administración con versión (409), sección en la
   ficha con «Ver detalles», pestaña de Administración, 3 observaciones iniciales.
3. Previsión: puntos meteorológicos, Worker con caché, tope y una descarga por punto, ficha y resumen en Comparar.
4. Clima habitual: preparación acotada en Actions, lectura y resumen ±7 días en la ficha.
5. Puntuación: los dos pesos a 0 con la fórmula de arriba, tras tu visto bueno.

## Decisión tomada (David, 18/11/2026)

Altitud de la previsión: se pasa a Open-Meteo la altitud documentada del punto en pistas (`elevation`). El proveedor
ajusta la temperatura a esa cota y puede elegir una celda vecina de altitud más parecida (comprobado: en ECMWF y
Météo-France cambian también lluvia y rachas). Se rotula «ajustado por Open-Meteo a X m» y SkiTrip no añade ninguna
corrección propia.
