# Validación

Fecha: 30/09/2026. Rama `rebuild/v2`, después de la revisión independiente del mismo día. Todo lo que figura aquí se ha ejecutado en el entorno de desarrollo. Ese entorno no tiene salida a las webs de estaciones, Esquiades, Estiber ni Open Prices (la política de red rechaza la conexión), y no tiene cuentas de Cloudflare ni Firebase. **No es una versión terminada ni desplegada.** Las categorías son estrictas:

- **Probado (local):** hay un test automático que pasa contra D1 local (workerd), el emulador oficial de Firebase Auth o fixtures.
- **Solo local, sin test automático:** se ha ejecutado a mano en local, pero no contra el servicio real.
- **Pendiente online:** necesita ejecutarse contra la web o el servicio real.
- **Pendiente de David:** necesita credenciales, exportaciones o su visto bueno.
- **No soportado por la fuente:** la fuente no publica el dato y no se inventa.

## Resultados

| Suite | Tests | Resultado |
|---|---|---|
| Lógica pura (`test/core`, sin parsers): calendario, repartos, presupuesto por condiciones, análisis, cesta, Comparar, partes, hojas | 58 | ✔ |
| Parsers (`test/core/parsers`): fixtures sintéticos + extracto real de Grandvalira | 82 | ✔ |
| Worker + D1 en workerd (`test/worker`): auth, permisos, calendario, viajes, gastos, compra, ingesta, cuotas, auditoría de consultas, revisión | 86 | ✔ |
| **Total Vitest** | **226** | **✔ 226/226** |
| Typecheck (`tsc`) | — | ✔ |
| Build de la SPA (`vite build`) | — | ✔ (559 kB de JS, 158 kB gzip; aviso de Vite por pasar de 500 kB, la mayor parte es el SDK de Firebase) |
| Playwright (`npm run e2e`): 22 recorridos × 360 px, 390 px y 1280 px, contra el emulador de Auth + Worker + D1 local | 66 | ✔ 66/66 |

Autoría: los 66 recorridos de navegador los escribí y ejecuté yo en el entorno de desarrollo (Claude). No son una verificación del revisor.

Cada corrección de la revisión tiene un test que reproducía el fallo antes del cambio (`test/worker/review-fixes.test.ts`, `quotas.test.ts`, y las secciones «revisión 5» de los parsers). Solo se cambiaron expectativas antiguas cuando codificaban el comportamiento que la revisión pedía corregir. Casos: una tarjeta sin «desde» ya no es cotización; confirmar dos veces un ticket devuelve el ya importado en vez de 409; y un test antiguo de presupuesto ahora declara fechas y ocupación.

## Qué se corrigió y cómo está probado

| Punto | Estado | Pruebas |
|---|---|---|
| 1 · D1 Free | Probado (local) | Ingesta: ≤ 8 sentencias para nieve (igual con 1 que con 29 fuentes) y ≤ 14 para 190 ofertas. Partes reanudables e idempotentes. Calendario de 150 días: 3. CSV de 500 filas: ≤ 12. Auditoría de 34 rutas con volumen: máximo 11 (ver `QUOTAS.md`). |
| 2 · Presupuesto por condiciones | Probado (local) | Cambio de fechas con la misma duración, ocupación por persona, noches incoherentes (422), otro destino, edades distintas, condiciones incompletas, estimación manual separada. e2e: la cotización queda como referencia al cambiar fechas. |
| 3 · Atomicidad | Probado (local) | Fallo a mitad de edición de gasto (trigger), dos ediciones simultáneas (una 200, otra 409), producto inexistente (422 sin escribir), fallo al guardar líneas, vinculación fallida recuperable sin reimportar. e2e: recuperación del ticket. |
| 4 · Identidad de ofertas | Probado (local) | Dos escenarios con el mismo hotel, precio y hora; mismo ID en otra área; cancelación distinta; condiciones no declaradas → orientativo con aviso; distribución por unidad y condiciones, nunca mediana conjunta. |
| 5 · Tipo de precio | Probado (local) | Sin «desde» sigue orientativo salvo fechas, adultos y menores declarados; forfait nulo = desconocido; contradicciones con aviso; varios precios → sin importe. |
| 6 · Compra y cesta | Probado (local) | Producto repetido (1 + 2 = 100 %), otras tiendas, canales y tipos no se mezclan, criterio explícito editable, cobertura parcial sin total, € y % contra el anterior comparable, cambio de formato, varias observaciones el mismo día. e2e de la cesta. |
| 7 · Capacidades honestas | Probado (local) | `/api/public/capabilities` y respuesta del escenario; la interfaz muestra la capacidad antes de crear y ya no promete resultados ni culpa al proveedor. Adaptador oficial de Grandvalira probado con texto real. |
| 8 · Ranking y coste | Probado (local) | Elección de nieve determinista; antigua, dudosa o sin estado excluida del criterio pero visible con fecha. Coste por persona: completos ordenados, incompletos sin posición. e2e de ambos. |
| 9 · Legacy | Probado (local) | Comentario publicado visible con autoría de la hoja; compra recuperable a un viaje con producto exacto, procedencia y sin duplicar; disponibilidad con vista e incorporación explícita (sin sobrescribir por defecto; días ausentes siguen sin indicar). La vista de disponibilidad legacy no tiene e2e (sí test de API). |

Errores encontrados durante la revisión que no estaban en la lista: crear un escenario daba 500 si no se había ejecutado el importador legacy (faltaban los proveedores; ahora los crea la migración 0008), y la lista de escenarios hacía dos consultas por escenario.

## Solo local, sin test automático

- **Recolectores con fixtures contra `wrangler dev` y una D1 local aislada** (30/09/2026, tras el cambio a partes):
  - nieve con el fixture sintético de Esquiades: 21 fuentes, 9 válidas, 8 filas escritas, 1 rechazada por el servidor, estado «parcial»;
  - ofertas con fixtures sintéticos: 19 fuentes, 62 observaciones, estado «ok»;
  - Grandvalira con el extracto real: 1 fila escrita.
- **Importador de hojas:** probado con las plantillas de `docs/templates`.
- **Copias de seguridad:** `backup.ts export --local` y `restore-test`.

## Pendiente online

- **Primera ejecución de los recolectores contra las webs reales.** Hasta entonces todas las fuentes figuran como «no verificada online». Para registrarlo hay un workflow manual de solo lectura (`v2 · comprobar fuentes online`, `tools/online-check.ts`) que guarda URL, fecha, filas obtenidas y errores sin escribir en la API.
- **Búsqueda de ofertas por fechas y ocupación:** no implementada. Falta verificar el formato de búsqueda de cada proveedor. La interfaz ofrece el enlace y la cotización manual.
- **Grandvalira oficial:** probado con un extracto de texto real obtenido con una herramienta de lectura web, no con el HTML crudo.
- **CPU de 10 ms:** no medido en Cloudflare (ver `QUOTAS.md`).
- **Workflows de GitHub Actions:** escritos, no ejecutados.

## Pendiente de David

- **Push al repositorio:** la cuenta conectada no tiene permiso de escritura en `Lilru-tech/skitrip`. El trabajo se entrega como bundle de git.
- **Despliegue:** proyecto de Firebase (Spark) y cuenta de Cloudflare (Free) de David, y su visto bueno. Pasos en `DEPLOY.md`, con las migraciones 0001–0008.
- **Exportaciones de las hojas** (comentarios, compra, disponibilidad) en CSV.
- **Red del entorno de desarrollo:** si se quiere verificar fuentes desde aquí, hay que permitir esos dominios en la configuración de red del entorno. Si no, se usa el workflow manual.

## Sin probar en la interfaz

- Lector de pantalla real (sí nombres y roles ARIA).
- Restablecimiento de contraseña con Firebase real.
- Acciones de administración con una cuenta de administrador (sí sus endpoints).
- La vista de disponibilidad legacy.
- Los enlaces a proveedores llevan a la portada pública: la API no guarda URL de búsqueda.

## No soportado por la fuente

- **Ordino Arcalís (web oficial):** no publica kilómetros.
- **Ax 3 Domaines (web oficial):** no publica km ni recuentos en texto.
- **Font-Romeu (Altiservice):** fuera de temporada solo muestra pistas de verano; revalidar en invierno.
- **Grandvalira fuera de temporada:** publica «0 / 215 km» sin texto de estado. Se guarda como estado desconocido y no puntúa.
- **Históricos hoteleros legacy:** sin hotel, noches, fechas ni ocupación; solo sirven como referencia agregada.
- **Open Prices:** cobertura muy escasa de productos de Mercadona en España.
- **Mercadona:** sin autorización; no hay precios automáticos y el adaptador directo sigue deshabilitado.
