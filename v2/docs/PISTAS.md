# Pistas y variedad: fuentes y cobertura

Número de pistas de esquí alpino por estación y, aparte, pistas abiertas del parte. Datos del catálogo en
`data/catalog.json` (`run_catalog`, tabla `area_runs`, migración 0020) y listados individuales en `data/run-lists.json`.
Consultas hechas el 19/10/2026, fuera de temporada, solo en páginas permitidas por su robots.txt.

## Qué se cuenta

- Pistas de esquí alpino tal como las identifica la estación. Si la estación cuenta por separado dos tramos
  (superior e inferior, I, II y III), cuentan por separado: no se fusionan por intuición.
- No cuentan: remontes, snowparks, zonas o circuitos infantiles, trineos, esquí de fondo, raquetas, rutas o itinerarios
  de montaña, fuera pista o freeride, ni la oferta nocturna de una pista que ya cuenta de día.
- Un dominio no se suma con sus estaciones. Si tiene cifra propia comparable se usa la suya. Si no publica cifra propia
  (ausencia de información), la suma de sus estaciones solo cuando todas tienen cifra comparable y ninguna se repite
  (cada pista es de una estación). Si publica una cifra propia que no es fiable (discrepancia pendiente, p. ej.
  Astún + Candanchú: ficha 110 frente a parte 116), no puntúa y no se sustituye por la suma de sus estaciones (114)
  hasta resolverla con evidencia; se muestran las cifras y el motivo.
- Con listado individual se cuenta por el identificador oficial (número del parte); si la estación no publica números,
  por el nombre exacto publicado, y se indica. Un identificador repetido con los mismos datos cuenta una vez; con datos
  distintos el listado no se acepta (`auditRunCatalog`). Con una sola cifra, se presenta como «total publicado».
- Si una fuente mezcla otras zonas sin poder separarlas, o dos cifras oficiales estructuradas (parte, ficha con desglose)
  no cuadran, la cifra se muestra con su limitación y no puntúa (`comparable: false`). Si una cifra estructurada que
  cuadra con su desglose contradice un texto descriptivo de la misma web, vale la estructurada y la discrepancia se
  documenta (Grandvalira 142 frente a «140 slopes», Port Ainé 25 frente a «27 slopes» en la descripción).
- Un dato ausente es «Sin dato», nunca 0. Las abiertas por color no se completan con los porcentajes del catálogo.
  Un cierre confirmado sin cifra da «0 abiertas deducido del cierre», sin colores.

## Recuentos: áreas, dominios y entradas de Comparar

- El catálogo tiene **24 áreas**: 3 dominios (Alp 2500, Formigal-Panticosa, Astún + Candanchú), sus 6 estaciones
  (La Molina y Masella; Formigal y Panticosa; Astún y Candanchú) y 15 estaciones sin dominio. Comparar muestra
  **18 entradas**: los 3 dominios (con sus estaciones dentro, no como destinos aparte) y las 15 estaciones sin dominio.
- **Áreas con cifra: 16** de 24 (las de la tabla con total). **Sin dato: 8** (Baqueira Beret, Cerler, Valdelinares,
  Javalambre, Formigal-Panticosa, Formigal, Panticosa y Masella).
- **Áreas con cifra comparable: 13**. Las 3 con cifra que no puntúan son discrepancias pendientes: Astún + Candanchú
  (ficha 110 frente a parte 116), Font-Romeu (41 frente a 47) y Les Angles (41 frente a 45, con freeride).
- **Entradas de Comparar que puntúan en Planificar: 10** de 18: Grandvalira, Pal Arinsal, Ordino Arcalís, Port Ainé,
  Espot, Boí Taüll, Port del Comte, Vall de Núria, Ax 3 Domaines y Alp 2500 (con su cifra propia, 131). La Molina,
  Astún y Candanchú tienen cifra comparable pero son estaciones de un dominio: se ven en la ficha del dominio y no
  puntúan como destinos aparte. No puntúan: Astún + Candanchú, Font-Romeu y Les Angles (discrepancia pendiente) y
  Baqueira, Cerler, Valdelinares, Javalambre y Formigal-Panticosa (sin dato).
- En Esquiar ahora puntúan solo las entradas con parte vigente que publica abiertas; hoy, fuera de temporada, ninguna.

## Cobertura por estación

«Abiertas» y «abiertas por color» dicen si el parte que ya leemos publica esas cifras. «Puntúa» = total comparable en
Planificar. «Fecha del dato» es la del documento o parte; «consultada» es el día de la consulta, que no dice que el dato
sea de la temporada actual.

| Estación | Total | Verdes/azules/rojas/negras | Abiertas (parte) | Abiertas por color | Recuento | Puntúa | Fuente | Temporada / fecha del dato | Consultada | Limitaciones |
|---|---|---|---|---|---|---|---|---|---|---|
| Alp 2500 (La Molina + Masella) | 131 | 29/45/45/12 | Esquiades por estación (sin fila del dominio) | No | cifra publicada | sí | [fuente](https://pirineu365.cat/en/lamolina/resort/alp2500/) | sin fecha del dato | 2026-10-19 | Cifra propia del dominio (La Molina + Masella), sin temporada indicada en la página. No se suma con sus estaciones. La página no enlaza directamente un plano. |
| Astún | 57 | 3/18/19/17 | Solo Esquiades del dominio | El parte oficial lo publica; sin recolector | listado individual | sí | [fuente](https://tienda.astuncandanchu.com/partenieve/pistas) | dato del 2026-09-15 | 2026-10-19 | Recuento del listado numerado del parte conjunto (59 entradas) sin la 3 «Trineos» ni la 19 «Snow Park». Parte fuera de temporada, sin temporada indicada. |
| Astún + Candanchú | 110 | 14/31/35/30 | Esquiades (agregado) | No | cifra publicada | no | [fuente](https://astuncandanchu.com/plano-de-pistas/) | sin fecha del dato | 2026-10-19 | La ficha técnica publica 110 pistas balizadas (14/31/35/30), pero el parte oficial lista 116 (16/33/37/30), 114 sin trineos ni snowpark. Dos cifras oficiales que no cuadran: la del dominio no puntúa. |
| Ax 3 Domaines | 38 | —/—/—/— | Esquiades (agregado) | Sin confirmar (carga en el navegador) | cifra publicada | sí | [fuente](https://www.ax.ski/fr/lastation) | sin fecha del dato | 2026-10-19 | Solo una cifra («38 pistes totalisant 80 km»), sin desglose por colores; la página no dice si incluye snowpark u otras zonas. |
| Baqueira Beret | Sin dato | —/—/—/— | Esquiades (agregado) | No | cifra publicada | no | [fuente](https://www.baqueira.es/en/datos-tecnicos-baqueira-beret) | sin fecha del dato | 2026-10-19 | Sin dato: baqueira.es rechaza la lectura automática (también su robots.txt) y no se ha intentado sortear. Pendiente de comprobación manual. |
| Boí Taüll | 43 | 6/6/15/16 | API FGC, en temporada | Sin confirmar: esperar al invierno | cifra publicada | sí | [fuente](https://pirineu365.cat/en/boitaull/resort/trail-map/) | sin fecha del dato | 2026-10-19 | Ficha sin temporada ni fecha. Snowparks (2), rutas de esquí de montaña (4), pista de trineos, zona infantil, jardín de nieve y estadio van aparte y no cuentan. |
| Candanchú | 57 | 12/14/18/13 | Solo Esquiades del dominio | El parte oficial lo publica; sin recolector | listado individual | sí | [fuente](https://tienda.astuncandanchu.com/partenieve/pistas) | dato del 2026-09-15 | 2026-10-19 | Recuento del listado numerado del parte conjunto (57 entradas). Los tramos que la estación numera por separado (Pista Grande I-III, Alto Aragón superior e inferior…) cuentan por separado. Parte fuera de temporada, sin temporada indicada. |
| Cerler | Sin dato | —/—/—/— | Parte Aramón si publica «x / y» (sin observar) | No | cifra publicada | no | [fuente](https://www.cerler.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| Espot Esquí | 22 | 2/10/6/4 | API FGC, en temporada | Sin confirmar: esperar al invierno | cifra publicada | sí | [fuente](https://pirineu365.cat/en/espotesqui/resort/trail-map/) | sin fecha del dato | 2026-10-19 | Ficha sin temporada ni fecha. El enlace al plano de la página apunta a un PDF de La Molina-Masella: no se enlaza. |
| Font-Romeu Pyrénées 2000 | 41 | 16/10/7/8 | Esquiades (agregado) | El parte oficial lo publica; sin adaptador | cifra publicada | no | [fuente](https://www.altiservice.com/font-romeu-pyrenees-2000/info-pistes) | dato del 2026-08-31 | 2026-10-19 | El parte publica 41 (16/10/7/8), pero la página del dominio da 47 (17/12/9/9) y también «41 runs». Cifras oficiales que no cuadran: no puntúa. El plano es de 2023. |
| Formigal | Sin dato | —/—/—/— | Dentro del parte del dominio | No | cifra publicada | no | [fuente](https://www.formigal-panticosa.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| Formigal-Panticosa | Sin dato | —/—/—/— | Parte Aramón si publica «x / y» (sin observar) | No | cifra publicada | no | [fuente](https://www.formigal-panticosa.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| Grandvalira | 142 | 23/53/46/20 | Sí (parte oficial) | Sí (parte oficial) | cifra publicada | sí | [fuente](https://www.grandvalira.com/ca/estacio/estat-de-pistes) | dato del 2026-09-30 | 2026-10-19 | Total y colores del parte oficial (fuera de temporada); los siete sectores suman 142. Snowparks, zonas especiales, circuitos infantiles y actividades van aparte y no cuentan. La página «slopes» dice «140 slopes»: se usa el parte, cuyo desglose y sectores cuadran. |
| Javalambre | Sin dato | —/—/—/— | Esquiades (agregado) | No | cifra publicada | no | [fuente](https://www.javalambre.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| La Molina | 66 | 20/18/22/6 | API FGC, en temporada | Sin confirmar: esperar al invierno | cifra publicada | sí | [fuente](https://pirineu365.cat/lamolina/estacio/planol-pistes-fitxa-tecnica/) | sin fecha del dato | 2026-10-19 | Ficha técnica sin temporada ni fecha (el plano se llama «hivern 2026»). Snowpark, circuitos de raquetas y de segway van aparte y no cuentan. |
| Les Angles | 41 | —/—/—/— | Esquiades (agregado) | Sin confirmar | cifra publicada | no | [fuente](https://lesangles.com/le-domaine/) | sin fecha del dato | 2026-10-19 | La página del dominio dice 41 pistas y sus sectores incluyen 4 de freeride; la página de información de pistas dice 45. No se puede separar ni saber cuál vale: no puntúa. Sin desglose oficial por colores. |
| Masella | Sin dato | —/—/—/— | Esquiades (agregado) | No | cifra publicada | no | [fuente](https://www.masella.com/ca/paginas/fitxa-tecnica) | sin fecha del dato | 2026-10-19 | Sin dato: no se ha podido comprobar el robots.txt de masella.com, así que no se usa su ficha. Las pistas de Masella están dentro de la cifra de Alp 2500. |
| Ordino Arcalís | 27 | 8/6/11/2 | Sí (parte oficial) | Sí (parte oficial) | cifra publicada | sí | [fuente](https://www.ordinoarcalis.com/es/estacion/estado-pistas) | dato del 2026-10-19 | 2026-10-19 | Total y colores del parte oficial (fuera de temporada). |
| Pal Arinsal | 47 | 7/19/17/4 | Sí (parte oficial) | Sí (parte oficial) | cifra publicada | sí | [fuente](https://www.palarinsal.com/es/estacion/parte-nieve) | dato del 2026-10-13 | 2026-10-19 | Total y colores del parte oficial (fuera de temporada). Winter Bike Park, raquetas y skimo van aparte y no cuentan. |
| Panticosa | Sin dato | —/—/—/— | Dentro del parte del dominio | No | cifra publicada | no | [fuente](https://www.formigal-panticosa.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| Port Ainé | 25 | 4/6/11/4 | API FGC, en temporada | Sin confirmar: esperar al invierno | cifra publicada | sí | [fuente](https://pirineu365.cat/en/portaine/resort/trail-map/) | sin fecha del dato | 2026-10-19 | Ficha sin temporada ni fecha. La descripción de la página dice «27 slopes»; el cuerpo dice 25 y sus colores suman 25: se usa 25. |
| Port del Comte | 29 | 7/11/8/3 | Sí (estado de cada pista) | Sí (estado y color de cada pista) | listado individual | sí | [fuente](https://www.portdelcomte.net/pistes/) | temporada 2025-26 · dato del 2026-04-05 | 2026-10-19 | La estación no publica un total: recuento del listado oficial (31 entradas) sin TUBBYS (trineos) ni EL BOSQUET (fuera pista). Sin números oficiales: se identifican por el nombre publicado. «Jardí de neu» cuenta porque la estación la clasifica como verde. Último parte de la temporada 2025-26. |
| Valdelinares | Sin dato | —/—/—/— | Esquiades (agregado) | No | cifra publicada | no | [fuente](https://www.valdelinares.com/) | sin fecha del dato | 2026-10-19 | Sin dato: el robots.txt de la web de Aramón no permite la lectura con la herramienta de consulta usada. Pendiente de comprobación manual. |
| Vall de Núria | 11 | 3/3/3/2 | API FGC, en temporada | Sin confirmar: esperar al invierno | cifra publicada | sí | [fuente](https://pirineu365.cat/en/valldenuria/resort/trail-map/) | sin fecha del dato | 2026-10-19 | Ficha sin temporada ni fecha. Pista infantil, trineos, tubing, boardercross, raquetas y esquí de montaña van aparte y no cuentan. |

## Comprobado con fuentes reales y solo con pruebas

- Con fuentes reales (19/10/2026): todas las cifras de la tabla, leídas en la web oficial citada. Además, los partes
  reales ya capturados de Grandvalira, Pal Arinsal, Ordino Arcalís y Port del Comte (`test/fixtures/real`) dan el mismo
  total y desglose que el catálogo (`test/core/runs.test.ts`). El listado de Astún–Candanchú se ha releído entero y sus
  colores suman los totales del propio parte (16/33/37/30).
- Solo con pruebas simuladas: abiertas en temporada de cualquier estación (todas están cerradas), el formato en
  temporada de la API de FGC y del parte de Aramón, y el cálculo con partes vigentes en Comparar.

## Pendiente de invierno o de comprobación manual

- API de FGC (La Molina, Vall de Núria, Espot, Port Ainé, Boí Taüll): fuera de temporada `skislopes.items` está vacío.
  Comprobar en temporada si lista pistas con color e identificador; hasta entonces solo se leen abiertas y totales.
- Andorra y Port del Comte: el formato de abiertas por color está visto con 0 abiertas; confirmar con estaciones abiertas.
  Un parte cuyo total por colores no cuadra con su total (completo que no lo suma o parcial que lo supera) conserva
  las cifras pero no se usan como denominadores por color, y se explica; las abiertas siguen valiendo si son coherentes.
- Baqueira Beret y las webs de Aramón (Cerler, Formigal-Panticosa, Valdelinares, Javalambre): no se han podido leer
  (Baqueira rechaza la lectura automática; Aramón no la permite en su robots.txt para la herramienta usada). Masella:
  su robots.txt no respondió, así que no se usa su ficha. Necesitan comprobación manual antes de cargar cifras.
- Astún, Candanchú y Font-Romeu publican abiertas por pista o por color en su parte oficial, pero no hay recolector:
  sería una fuente nueva.
- Las cifras de catálogo sin temporada indicada deben revisarse cuando las estaciones publiquen la ficha 2026-27.

## Qué proceso actualiza cada dato

| Dato | Tabla | Quién lo actualiza | Cuándo |
|---|---|---|---|
| Total y colores del catálogo (para planificar) | `area_runs` | La publicación (`v2-release`) importa `data/catalog.json` (`run_catalog`) con `tools/import-legacy.ts` → `tools/run-catalog-sql.ts` | En cada publicación; el archivo se revisa a mano |
| Aportaciones manuales al total y a los colores | `area_run_contributions` + `area_run_history` | Administración › Pistas (`/api/admin/runs`) | Cuando un administrador las guarda, retira o restaura |
| Pistas abiertas, abiertas por color y totales del parte | `snow_observations` | Captura de nieve (`v2-snow`, `POST /api/ingest/snow`) | Cada captura programada |
| Estado de apertura, nieve y km | `snow_observations` | Captura de nieve | Cada captura programada |

La edición de administración solo toca el total y los colores del catálogo. No cambia el parte diario (abiertas,
apertura, nieve, km) ni las rutas, precios o cierres. No se ha añadido ningún recolector nuevo.

## Aportaciones manuales y prioridad

`area_runs` es el catálogo importado (lo llamamos «automático»: lo reescribe cada publicación). Una edición guardada
ahí desaparecería en el siguiente despliegue, así que las aportaciones manuales viven en su propia tabla
(`area_run_contributions`, migración 0021), con historial (`area_run_history`) que nunca se borra. La importación no las
toca; si cambia la cifra importada de un área con aportación activa, lo anota en el historial (`import_change`).
Reimportar sin cambios no anota nada ni borra nada.

Una única regla decide la cifra efectiva (`resolveRunCatalog`, `src/core/runs-manual.ts`). El Worker la aplica al
servir el catálogo y la ficha, así que fichas, Comparar, dominios y puntuación usan la misma cifra:

La temporada solo se compara cuando **las dos fuentes la declaran** («2026-27»). No se deduce de la fecha de
publicación, porque un documento de septiembre puede describir la temporada anterior, y «desconocida» nunca cuenta como
«la misma». El resultado **no cambia solo porque pase el tiempo**: una cifra sin temporada no recupera la prioridad al
empezar otra temporada.

0. Aportación de una temporada que **aún no ha empezado** (ficha publicada por adelantado, como mucho la próxima
   temporada): se guarda, pero no se aplica hasta que empiece; no sustituye los datos de la temporada en curso ni toca
   los partes de «Esquiar ahora». La fecha de la fuente sigue sin poder ser futura: temporada futura no es fecha futura.
1. Cifra importada válida (enteros, desglose coherente, comparable) y de la **misma temporada** que la aportación:
   **prevalece la importada**. La aportación solo completa los campos que faltan (un color o el total), si la
   combinación cuadra y la aportación no está marcada como no comparable. Si no cuadra, no se mezcla: se muestra lo
   importado y queda pendiente.
2. Cifra importada válida de una temporada **posterior**: prevalece la importada y la aportación no se aplica; el cambio
   queda en el historial.
3. Cifra importada que falta, no es fiable (discrepancia pendiente, desglose que no cuadra), es de una temporada
   **anterior**, o **no indica temporada frente a una aportación con temporada explícita**: la aportación la
   **sustituye entera**. La ficha dice qué cifra importada se sustituye. Si la temporada de la aportación ya pasó, se
   mantiene con su temporada y se marca «por revisar» para la temporada en curso; no se presenta como dato de la nueva.
4. Cifra importada válida y aportación sin temporada, o importada con temporada y aportación sin ella: prevalece la
   importada, pero **no se combinan** sus campos. Las dos quedan por separado y la vista previa lo explica.
5. Una aportación retirada no cuenta. Restaurarla vuelve a pasar por las mismas reglas: si mientras tanto llegó un dato
   automático válido, prevalece el automático y la aportación queda guardada sin aplicar.

Las cifras manuales se muestran como «Aportación manual de administración» con su referencia, la temporada o fecha de la
fuente y el día en que se introdujeron; siempre como total publicado, nunca como listado pista a pista ni como
comprobación automática oficial. El público ve la referencia, la temporada y las fechas, y la explicación cuando resuelve
una discrepancia; el motivo, la autoría y el historial solo los ve administración.

Validación (en el navegador y en el servidor, `validateManualDraft`): enteros de 0 en adelante; vacío = sin dato, 0 =
cero confirmado; al menos una cifra; desglose completo = total, parcial ≤ total; no se deducen pistas de km ni de
porcentajes ni se suman colores para inventar un total; fuente o referencia comprobable (https o cita) y motivo;
temporada «2026-27», como mucho la próxima; fecha de la fuente no futura. Si la cifra importada tiene una discrepancia pendiente (Astún +
Candanchú, Font-Romeu, Les Angles), la aportación solo puede marcarse comparable con una explicación con evidencia
(30 caracteres como mínimo), que queda registrada y se publica en los detalles. Sin ella, se puede guardar como no
comparable. Las reglas de dominios no cambian: una cifra propia del dominio no se suma con sus estaciones y una
discrepancia no se sustituye por la suma de las estaciones.

Se pueden guardar datos parciales: por ejemplo, solo 10 verdes sin total, o un total de 40 con solo las verdes. Se
muestran los valores conocidos como desglose parcial y el resto como «sin dato»; nunca se inventa el total ni se rellena
con ceros. Sin total no puntúa en «Variedad de pistas».

Una aportación por área (no hay duplicados). Cada escritura lleva la versión que se editó: si otro administrador guardó
antes, la API responde 409 y no sobrescribe. El historial guarda quién, cuándo, la acción, los valores anteriores y
nuevos, la fuente y el motivo.

## Mantenimiento

El catálogo de pistas no cambia con cada parte: se revisa a mano cuando cambia la ficha de una estación, se edita
`run_catalog` (y `data/run-lists.json` si es un listado) con fuente y fechas, y la publicación lo importa. La importación
para si la revisión encuentra errores (`auditRunCatalog`). Para un dato que falta o que llega antes de revisar el
archivo, Administración › Pistas permite una aportación manual con las reglas anteriores. En producción supone una
lectura de ~24 filas de `area_runs` y de las aportaciones activas por carga del catálogo y ninguna consulta externa al
mostrar las tarjetas.
