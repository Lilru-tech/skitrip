# Puntos de llegada en coche

Destino de las rutas del **origen personalizado** (Geoapify): el punto donde se deja el coche en cada estación comparada, no el centro de la estación. Datos en `migrations/0017_custom_origin.sql` (tabla `area_access`). Consultados el **16/10/2026**.

## Qué significa cada grado

- **Contrastado**: dos fuentes públicas independientes dan el mismo punto (a menos de ~0,5 km). La mayoría de coordenadas vienen de la ficha «arrival-car» de skiresort.com, que las toma de Google Maps y avisa de que se ofrecen «sin garantía»; se han contrastado con la web oficial de la estación, una web de turismo o park4night.
- **Una sola fuente**: solo se ha encontrado una fuente (skiresort.com). La interfaz lo dice en la ruta: «Punto de llegada según una sola fuente pública, sin contrastar».
- **Aproximado**: el punto no es el aparcamiento real o no se ha podido confirmar. La interfaz lo dice: «Punto de llegada aproximado, sin confirmar».
- Ningún punto se ha comprobado sobre el terreno ni en un mapa oficial. OpenStreetMap, Overpass y Wikidata no eran accesibles desde el entorno de trabajo, así que no se han usado como fuente.
- Una estación sin fila en `area_access` usa el punto central del catálogo y la ruta lo indica: «punto central de la estación en el catálogo, no un acceso verificado». Hoy las 19 estaciones comparadas tienen punto de llegada.

Las rutas desde **Tarragona y Sabadell** no cambian: son las curadas en `data/catalog.json` y siguen marcadas como «punto aproximado de la estación en el catálogo» cuando lo son.

## Estaciones

| Estación | Punto de llegada | Coordenadas | Grado | Fuentes |
|---|---|---|---|---|
| Grandvalira | Funicamp (Encamp), aparcamiento de pago — Primera entrada desde el sur; Canillo, Soldeu, El Tarter, Grau Roig y Pas de la Casa tienen sus propios aparcamientos, más lejos. | 42.53552, 1.58775 | **Una sola fuente** | [1](https://www.skiresort.com/en/ski-resort/grandvalira-pas-de-la-casa-grau-roig-soldeu-el-tarter-canillo-encamp/arrival-car/) |
| Pal Arinsal | Pal, aparcamiento de La Caubella — También se sube en telecabina desde La Massana (aparcamiento de pago) o desde Arinsal. | 42.53642, 1.49018 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/pal-arinsal-la-massana/arrival-car/) · [2](https://www.palarinsal.com/en/resort/parking) |
| Ordino Arcalís | Aparcamiento de La Basera / L'Hortell | 42.63123, 1.50014 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/ordino-arcalis/arrival-car/) · [2](https://ordinoarcalis.com/en/resort/how-to-arrive-park) |
| Alp 2500 (La Molina + Masella) | La Molina, base del telecabina Cadí-Moixeró — Masella tiene su propio acceso, a unos minutos. | 42.33468, 1.93492 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/la-molina-masella-alp2500/arrival-car/) · [2](https://park4night.com/en/place/21060) |
| Baqueira Beret | Baqueira 1500, aparcamiento del telecabina Baqueira II — Beret tiene otro acceso, más arriba. | 42.69868, 0.93438 | **Una sola fuente** | [1](https://www.skiresort.com/en/ski-resort/baqueira-beret/arrival-car/) |
| Port Ainé | Port Ainé 2000 (base) — En invierno se aparca en el nuevo aparcamiento de Rabasta, cuya ubicación exacta no está publicada: el punto es la base de la estación. | 42.4284, 1.21384 | **Aproximado** | [1](https://www.skiresort.com/en/ski-resort/port-aine/arrival-car/) · [2](https://surtdecasa.cat/pirineus/llocs-interes/rialp/estacio-de-muntanya-de-port-aine) |
| Espot Esquí | Espot, base de La Roca | 42.56358, 1.09372 | **Una sola fuente** | [1](https://www.skiresort.com/en/ski-resort/espot-esqui/arrival-car/) |
| Boí Taüll | Boí Taüll, base de Pla de Vaques | 42.47814, 0.87053 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/boi-tauell/arrival-car/) · [2](https://femturisme.cat/es/establecimientos/estacio-muntanya-boi-taull) |
| Port del Comte | Port del Comte, base de El Querol | 42.17227, 1.56126 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/port-del-comte/arrival-car/) · [2](https://park4night.com/en/place/28482) |
| Vall de Núria | Aparcamiento de la estación del cremallera de Queralbs — Sin acceso en coche: la ruta llega al aparcamiento del cremallera en Queralbs. No incluye la subida en cremallera de Queralbs a Núria (unos 17 min y unos 750 m de desnivel), con billete aparte: en el presupuesto es la partida «Cremallera», pendiente hasta indicar su precio o que el forfait o paquete de la opción lo incluye. Horarios y precios en valldenuria.cat. También se puede subir desde Ribes de Freser (unos 39 min). | 42.35168, 2.1665 | Contrastado (2 fuentes) | [1](https://park4night.com/en/place/77715) · [2](https://barcelonaurbana.com/ca/blog/vall-de-nuria-preu-del-cremallera-i-horaris) |
| Cerler | Cerler, aparcamiento de El Molino — Ampriú (1.900 m) tiene otro acceso por carretera. | 42.58692, 0.54021 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/cerler/arrival-car/) · [2](https://park4night.com/en/place/44187) |
| Valdelinares | Valdelinares, aparcamiento del sector central | 40.37938, -0.63331 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/valdelinares-sierra-de-gudar/arrival-car/) · [2](https://park4night.com/en/place/203111) |
| Javalambre | Javalambre, aparcamiento de la base (Camarena de la Sierra) | 40.11429, -1.01749 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/javalambre/arrival-car/) · [2](https://park4night.com/es/place/169366) |
| Font-Romeu Pyrénées 2000 | Font-Romeu, telecabina Airelles Express (aparcamiento cubierto) — Pyrénées 2000 (Bolquère) tiene su propio acceso. | 42.50558, 2.04176 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/font-romeu-bolquere-pyrenees-2000/arrival-car/) · [2](https://www.skipass.com/news/font-romeu-nouvelle-telecabine-airelles.html) |
| Les Angles | Les Angles, aparcamiento de Pla del Mir — También hay telecabina desde el pueblo (Les Pèlerins). | 42.5641, 2.06481 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/les-angles/arrival-car/) · [2](https://www.visit-occitanie.com/en/fiche/hotellerie-plein-air/aire-de-stationnement-camping-car-les-angles_TFOACCAMLAR06600021/) |
| Ax 3 Domaines | Ax 3 Domaines, aparcamiento de Bonascre — También se sube en telecabina desde Ax-les-Thermes. | 42.6995, 1.81292 | Contrastado (2 fuentes) | [1](https://www.tourisme-occitanie.com/fr/fiche/equipement/station-d-ax-3-domaines-ax-les-thermes_TFOSITRA2_SKI_6250186/) · [2](https://www.skiresort.com/en/ski-resort/ax-3-domaines-ax-les-thermes/arrival-car/) |
| Formigal-Panticosa | Formigal, aparcamiento de Sextas — Panticosa tiene su propio acceso (telecabina desde el pueblo), a unos 20 min. | 42.77481, -0.37275 | **Una sola fuente** | [1](https://www.skiresort.com/en/ski-resort/formigal/arrival-car/) |
| Astún | Astún, aparcamiento de la base | 42.80989, -0.50435 | Contrastado (2 fuentes) | [1](https://www.skiresort.com/en/ski-resort/astun/arrival-car/) · [2](https://park4night.com/fr/place/483267) |
| Candanchú | Candanchú, aparcamiento de Tobazo | 42.78811, -0.52987 | **Una sola fuente** | [1](https://www.skiresort.com/en/ski-resort/candanchu/arrival-car/) |

## Sin verificar

- **Grandvalira, Baqueira Beret, Espot Esquí, Formigal-Panticosa (Sextas) y Candanchú**: una sola fuente; no se ha encontrado otra que lo confirme.
- **Port Ainé**: el punto es la base Cota 2000. En invierno se aparca en seis aparcamientos escalonados de la carretera de acceso (Cota 1650, Riu Sec, Rabasta, Roní, Jet Cim y La Font, según [pirineu365](https://pirineu365.cat/en/portaine/resort/practical-information/)), cuya ubicación exacta no está publicada. Nota actualizada en la migración 0019.
- **Vall de Núria desde Ribes de Freser**: la fuente no distingue Ribes-Enllaç de Ribes-Vila; por eso la ruta va a Queralbs (contrastado) y Ribes solo se menciona en la nota.
- **Formigal-Panticosa en el catálogo**: hasta el 16/10/2026 el punto del dominio en `data/catalog.json` era (42,744; 0,055), a unos 30 km de Formigal y de Panticosa, y las rutas guardadas desde Tarragona (370 km, 334 min) y Sabadell (416 km, 361 min) iban a él. Ahora es el aparcamiento de Sextas (42,77481; −0,37275; [skiresort.com](https://www.skiresort.com/en/ski-resort/formigal/arrival-car/)), a menos de 1,5 km del pueblo de Formigal, y las rutas se han recalculado con OSRM el 16/10/2026: Tarragona 292 km y 223 min; Sabadell 338 km y 250 min. Panticosa queda unos 15 km antes por la misma carretera. Es un punto de una sola fuente y la ruta lo dice.

## Vall de Núria: el tramo que no incluye la ruta

No se llega en coche. La ruta del origen personalizado termina en el **aparcamiento de la estación del cremallera de Queralbs** (gratuito). No incluye la subida en cremallera de Queralbs a Núria (1.964 m): unos 17 min según horario y unos 750 m de desnivel. Desde Ribes-Enllaç son unos 39 min.

**El cremallera es una partida propia del presupuesto** (migración 0018). Si el destino del cálculo es Vall de Núria:

- Sin precio y sin constancia de que el forfait o el paquete de esa opción lo incluyan, la partida «Cremallera» queda **pendiente**: el presupuesto no es completo, no da coste por persona y no puntúa en el criterio de precio.
- Con precio (por persona, toda la estancia: una ida y vuelta, o una por día si se duerme abajo), se suma una vez por persona. 0 € es un dato válido (vuestro forfait ya lo incluye).
- Si la candidatura marca «¿El forfait o paquete de esta opción incluye el cremallera?» = «Sí, confirmado», no se suma a quien esquía (no se cuenta dos veces); a quien no esquía, sí.
- En otra estación que no sea el destino del viaje, el precio común del viaje no se toma como confirmado: queda pendiente salvo que se indique en «Costes por estación» o en la candidatura.

Precios encontrados (16/10/2026, tarifas de la temporada 2025-2026 en [pirineu365.cat](https://pirineu365.cat/en/valldenuria/resort/rates/), sin confirmar en valldenuria.cat): forfait de día **sin** cremallera 23,50 € adulto; «forfait de día + cremallera» 41 € adulto, 31 € infantil; cremallera solo, ida y vuelta, 31 € adulto y 20 € infantil desde Queralbs, y 34 € y 22 € desde Ribes. El billete combinado Skitren (Renfe R3 + cremallera + forfait de un día, 47,70 € adulto en 2025-2026, [lugaresdenieve.com](https://www.lugaresdenieve.com/?q=es%2Fnoticia%2Ffgc-renfe-skitren-trenatura-la-molina-vall-de-nuria)) también lo incluye. Una central de reservas ([centraldereservas.com](https://actividades.centraldereservas.com/d/queralbs/forfait-vall-de-nuria-lstRM8M88)) dice que «todos los forfaits» lo incluyen, pero la tabla de tarifas distingue forfaits con y sin cremallera. Por eso **depende del producto concreto** y la aplicación no lo da por incluido: lo indica cada candidatura.

## Port Ainé: tiempo dudoso desde un origen personalizado

El 16/10/2026, desde la plaza del Mercadal de Reus, Geoapify dio **210 km y 334 min** hasta Port Ainé (ejecución 38886245758). Revisión:

- **Punto de llegada**: base Cota 2000, la dirección de la estación («Estació de Muntanya Cota 2000, Rialp»). OSRM lo ajusta a 12 m de la carretera, al final de la carretera de acceso a Port Ainé: está conectado.
- **Otro proveedor (OSRM)**, mismo origen y mismo punto: **212 km y 222 min**. La distancia coincide (2 km de diferencia), así que el recorrido es el mismo: Rialp, carretera de Roní (4,6 km) y carretera de acceso a Port Ainé (13,9 km), unos 40 min desde Rialp.
- **Comparación con las otras 18 estaciones**: con los mismos datos de Reus, el tiempo de Geoapify queda entre 0,71 y 1,13 veces el que da la velocidad media de su ruta OSRM. Port Ainé queda en 1,75 veces.
- **Causa**: la matriz de Geoapify no devuelve el recorrido ni el tipo de vía, así que no se puede saber qué tramo penaliza. El exceso (unos 110 min) está en el tiempo del proveedor, no en el punto ni en la distancia. No se ha cambiado la coordenada ni el tiempo.
- **Lo que hace la aplicación**: si el tiempo del proveedor supera en más de 1,4 veces el que da la velocidad media de la ruta OSRM más rápida guardada para esa estación (de 50 km o más), se muestra tal cual, marcado como «tiempo dudoso», con una nota que da la referencia. La distancia (la que se usa para el combustible) no cambia.
- **Ruta guardada desde Tarragona**: era la distancia heredada de 225 km sin tiempo ni fuente. Ahora es OSRM, 216 km y 220 min hasta el mismo punto (16/10/2026).

## Cómo actualizar

Cambiar la fila en una migración nueva (`INSERT OR REPLACE INTO area_access …`) con `source` (URL o URLs separadas por ` · `), `confidence` y `checked_on`, y la tabla de este documento. `test/worker/area-access.test.ts` comprueba que todas las estaciones con ruta tienen punto, fuente y fecha, y que ninguno «contrastado» cita una sola página.
