# Matriz de fuentes

> Generado con `npx tsx tools/gen-sources-doc.ts` desde `data/catalog.json`. No editar a mano.

«No verificada online» significa que el adaptador está probado con fixtures sintéticos pero todavía no ha corrido contra la web real (este entorno no tiene salida a esas webs; la primera ejecución real será en GitHub Actions). Un campo que una fuente no publica se queda vacío: nunca se infiere.

## Nieve

| Ámbito | Proveedor | Método | Campos | Adaptador | Estado | Revisada | Limitaciones |
|---|---|---|---|---|---|---|---|
| Alp 2500 (La Molina + Masella) | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. Solo la fila «Alp 2500»; la fila «La Molina» es otra fuente con otro ámbito. |
| Astún + Candanchú | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. Esquiades publicaba la misma cifra (101 km) bajo Astún y bajo Candanchú: es el dominio conjunto. Se registra una sola vez, en el dominio. |
| Ax 3 Domaines | official | playwright | op_status | sin adaptador | no verificada online | 2026-09-30 | Comprobada el 30/09/2026: periodo de apertura 05/12/2026–29/03/2027 y mapa interactivo; no publica km ni recuentos en texto. No se infieren km. |
| Ax 3 Domaines | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Baqueira Beret | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Boí Taüll | pirineu365 | playwright | open_km, total_km, open_runs, total_runs, op_status | sin adaptador | no verificada online | 2026-09-30 | Misma página FGC que La Molina; valores dinámicos. |
| Boí Taüll | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Cerler | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Espot Esquí | pirineu365 | playwright | open_km, total_km, open_runs, total_runs, op_status | sin adaptador | no verificada online | 2026-09-30 | Misma página FGC que La Molina; valores dinámicos. |
| Espot Esquí | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Font-Romeu Pyrénées 2000 | official | html | open_runs, total_runs, open_lifts, total_lifts | sin adaptador | no verificada online | 2026-09-30 | Comprobada el 30/09/2026 fuera de temporada: solo pistas de verano y remontes (0/7, 0/5). Sin km. Revalidar en invierno. |
| Font-Romeu Pyrénées 2000 | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Formigal-Panticosa | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. Fila del conjunto; no se replica en Formigal ni en Panticosa. |
| Grandvalira | official | html | open_km, total_km, open_runs, total_runs, open_lifts, total_lifts, depth_min_cm, depth_max_cm, op_status, source_date | sin adaptador | no verificada online | 2026-09-30 | Página comprobada manualmente el 30/09/2026: muestra «0 / 215km», pistas por color, remontes 4/73, espesores y «Última actualización». Falta adaptador probado. |
| Grandvalira | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Javalambre | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| La Molina | pirineu365 | playwright | open_km, total_km, open_runs, total_runs, op_status | sin adaptador | no verificada online | 2026-09-30 | Comprobada el 30/09/2026: lista La Molina, Vall de Núria, Vallter, Espot, Port Ainé y Boí Taüll; los valores se cargan dinámicamente (hace falta navegador). Sirve también para vall-de-nuria, espot-esqui, port-aine y boi-taull. |
| La Molina | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Les Angles | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Masella | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Ordino Arcalís | official | html | open_runs, total_runs, open_lifts, total_lifts, depth_min_cm, depth_max_cm, op_status, source_date | sin adaptador | no verificada online | 2026-09-30 | Comprobada el 30/09/2026: publica pistas por color, remontes y espesores, pero NO kilómetros. No se infieren km por proporción. |
| Ordino Arcalís | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Pal Arinsal | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Port Ainé | pirineu365 | playwright | open_km, total_km, open_runs, total_runs, op_status | sin adaptador | no verificada online | 2026-09-30 | Misma página FGC que La Molina; valores dinámicos. |
| Port Ainé | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Port del Comte | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Valdelinares | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |
| Vall de Núria | pirineu365 | playwright | open_km, total_km, open_runs, total_runs, op_status | sin adaptador | no verificada online | 2026-09-30 | Misma página FGC que La Molina; valores dinámicos. |
| Vall de Núria | esquiades | playwright | open_km, total_km, open_runs, total_runs, op_status | esquiades-status | no verificada online | — | Agregador; coincidencia exacta de nombre, alias en orden de prioridad. Adaptador reescrito, no ejecutado online desde el entorno de desarrollo. |

## Ofertas de alojamiento y paquetes

| Ámbito | Proveedor | Método | Campos | Adaptador | Estado | Revisada | Limitaciones |
|---|---|---|---|---|---|---|---|
| Astún | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Astún + Candanchú | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Ax 3 Domaines | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Baqueira Beret | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Boí Taüll | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Cerler | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Espot Esquí | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Font-Romeu Pyrénées 2000 | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Formigal-Panticosa | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Grandvalira | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Javalambre | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| La Molina | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Les Angles | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Ordino Arcalís | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Pal Arinsal | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Port Ainé | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Port del Comte | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Valdelinares | estiber | playwright | offer_cards | estiber-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |
| Vall de Núria | esquiades | playwright | offer_cards | esquiades-cards | no verificada online | — | URL heredada del catálogo legacy. Paquete de alojamiento + forfait con fechas propias del proveedor, no de tu viaje. |

## Precios de supermercado

| Fuente | Estado | Uso | Limitaciones |
|---|---|---|---|
| Mercadona (web/API directa) | **Deshabilitada** (`src/worker/price-providers.ts`, `enabled: false`) | Ninguno | Sin autorización del titular. No se sustituye por proxy, extensión ni otro mecanismo equivalente. |
| Precio manual | Implementada y probada | Precio con tienda, CP (43007 por defecto), canal y fecha | Lo introduce una persona; queda marcado como manual. |
| CSV propio | Implementada y probada | Previsualizar y confirmar; el servidor vuelve a analizar el CSV | Columnas en `src/worker/routes/shopping.ts`. |
| Ticket en texto | Implementada y probada | Pegar el texto del ticket, revisar líneas y confirmar; puede crear un gasto | Sin OCR. El formato de ticket se ha probado con un fixture sintético. |
| Open Prices (Open Food Facts) | Implementada, no verificada online | Capa colaborativa separada, caché 7 días, atribución ODbL visible | Cobertura muy escasa para productos de Mercadona en España; nunca se mezcla con los precios propios. |

## Distancias

Rutas por carretera curadas en `data/catalog.json` (`routes`), heredadas del legacy con su fuente y fecha. `validateRoutes` marca incoherencias (ruta más corta que la línea recta, desvíos excesivos, vecinos con distancias dispares); las marcadas se muestran como «por revisar». La distancia en línea recta solo se usa como estimación geográfica.
