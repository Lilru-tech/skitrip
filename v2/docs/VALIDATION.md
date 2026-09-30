# Validación

Fecha: 30/09/2026. Rama `rebuild/v2`, después de la corrección final sobre la entrega 64c3642. Todo lo que figura aquí se ha ejecutado en el entorno de desarrollo. Ese entorno no tiene salida a las webs de estaciones, Esquiades, Estiber ni Open Prices (la política de red rechaza la conexión), y no tiene cuentas de Cloudflare ni Firebase. **No es una versión terminada ni desplegada.** Las categorías son estrictas:

- **Probado (local):** hay un test automático que pasa contra D1 local (workerd), el emulador oficial de Firebase Auth o fixtures.
- **Solo local, sin test automático:** se ha ejecutado a mano en local, pero no contra el servicio real.
- **Pendiente online:** necesita ejecutarse contra la web o el servicio real.
- **Pendiente de David:** necesita credenciales, exportaciones o su visto bueno.
- **No soportado por la fuente:** la fuente no publica el dato y no se inventa.
- **Sin implementar:** falta trabajo nuestro; no es una limitación de la fuente.

## Resultados

| Suite | Tests | Resultado |
|---|---|---|
| Lógica pura (`test/core`, sin parsers): calendario, repartos, presupuesto por condiciones y escenario por candidatura, análisis, cesta, Comparar, partes, hojas | 74 | ✔ |
| Parsers (`test/core/parsers`): fixtures sintéticos, extracto real de Grandvalira e identidad de oferta | 86 | ✔ |
| Worker + D1 en workerd (`test/worker`): auth, permisos, calendario, viajes, gastos, compra, ingesta, cuotas, auditoría de las 106 rutas, revisión | 97 | ✔ |
| **Total Vitest** | **257** | **✔ 257/257** (antes 226) |
| Cobertura de la auditoría (`npx tsx tools/check-audit-coverage.ts`) | 106 rutas | ✔ 106/106 medidas, máximo 17 sentencias |
| Typecheck (`tsc`) | — | ✔ |
| Build de la SPA (`vite build`) | — | ✔ (561 kB de JS, 159 kB gzip; aviso de Vite por pasar de 500 kB, la mayor parte es el SDK de Firebase) |
| Playwright (`CI=1 npx playwright test`): 24 recorridos × 360 px, 390 px y 1280 px, contra el emulador de Auth + Worker + D1 local, en copia limpia sin `.dev.vars` | 72 | ✔ 72/72 (commit 23dbc3b) |

En la primera ejecución en copia limpia fallaron 3 de 72: el recorrido nuevo de nieve buscaba Gamma (a 780 km) con el filtro por defecto de 300 km. Era un fallo del test, no de la aplicación: ahora el recorrido amplía la distancia a 800 km, como haría una persona, y pasa.

Autoría: todos los recorridos de navegador los escribí y ejecuté yo en el entorno de desarrollo (Claude). No son una verificación del revisor.

### E2E en copia limpia (equivalente local de CI, no GitHub Actions)

- Copia limpia: `git clone` de la rama en un directorio nuevo, sin `.dev.vars` (solo existe `.dev.vars.example`), `npm ci`, sin servidores previos en 9099/8787/5173 y con `CI=1`, que impide reutilizar servidores.
- Antes del cambio, en otra copia limpia del commit anterior (d689ed4): el primer recorrido falla con «Origen no permitido» (403). Vite reenvía `/api` con `changeOrigin`, el navegador llega con `Origin: http://localhost:5173` y, sin `.dev.vars`, `ALLOWED_ORIGINS` estaba vacío.
- Ahora `playwright.config.ts` pasa al Worker una configuración explícita de prueba (`test/e2e/env.ts`): orígenes locales `http://localhost:5173,http://localhost:8787`, modo emulador, proyecto `demo-skitrip`, límite de perfiles de prueba y una credencial de ingesta de prueba que no es secreta. Se pasan con `--var`, que además tiene prioridad sobre un `.dev.vars` local.
- Producción no cambia: `wrangler.jsonc` sigue con `ALLOWED_ORIGINS` vacío (solo mismo origen) y no se admiten comodines.
- Datos de prueba aparte: la D1 de E2E se recrea en `test/e2e/.state` en cada ejecución y no toca la base de desarrollo.
- Chromium: el que instala `npx playwright install chromium`. `PW_CHROMIUM_PATH` solo se usa si se define. En este entorno se definió porque el Chromium preinstalado (1194) no es el de la versión de Playwright del proyecto (1243).
- **GitHub Actions real: no ejecutado.** El workflow `v2-ci.yml` hace lo mismo (comprueba que no hay `.dev.vars`, instala Chromium con Playwright y usa `CI=1`), pero no se ha ejecutado en GitHub porque no hay permiso de push.

## Corrección final (7 puntos)

Cada punto tiene tests que fallaban antes del cambio y pasan después. Se ejecutaron contra el código anterior, en una copia aparte cuando hacía falta.

| Punto | Estado | Cambios y pruebas |
|---|---|---|
| 1 · Identidad de oferta | Probado (local) | Una sola identidad (`src/core/offer-identity.ts`) para dedupe del recolector, ingesta, persistencia e histórico: proveedor/ID u hotel, régimen, cancelación, unidad, noches, entrada, salida, adultos, edades de menores, habitaciones, forfait (sí/no/desconocido) y días. Tests: mismas noches en otras fechas, otras edades, otras habitaciones, forfait desconocido frente a «sin forfait», y un duplicado real que sí se une. Las cinco tarjetas llegan a la API y a la ficha. |
| 2 · Forfait desconocido | Probado (local) | La ficha pública devuelve `forfaitIncluded`, menores, habitaciones y avisos. La interfaz separa «Solo alojamiento», «Alojamiento + forfait» y «Forfait sin confirmar», con recuento y nota. Un desconocido nunca aparece como solo alojamiento. API: sí/no/desconocido/contradictorio sin perder ofertas. e2e: grupo «sin confirmar» con avisos en 360, 390 y 1280 px. |
| 3 · Frescura de la nieve | Probado (local) | Ver «Criterio de frescura de la nieve». Tests: parte antiguo capturado hoy, parte reciente, sin fecha, fuente preferida con parte antiguo frente a alternativa con parte reciente, fecha futura (dudosa). Se mantienen las exclusiones por calidad y por estado desconocido. La ficha y Comparar muestran las dos fechas. |
| 4 · Presupuesto | Probado (local) | Viaje con 2 habitaciones y cotización sin habitaciones: pendiente. Paquete con 2 días de forfait y viaje sin días de esquí: incompleto. Simetría en habitaciones, menores y forfait. No se exigen habitaciones si ninguna parte las fija y el precio no es por habitación. Estimación manual aparte. Con controles compatibles, en lógica pura y por API. |
| 5 · Avisos leídos | Probado (local) | `POST /api/notifications/read`: una sola sentencia `UPDATE … WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))`. El contador no se ha tocado. Tests: 50 y 100 IDs (mismas sentencias), repetidos, IDs de otro usuario (no se tocan) y lista vacía. Antes, 50 IDs daban 503 `query_budget`. Incluida en la auditoría de cuotas. e2e: tarjetas → analizador → ingesta → oferta guardada → cambio de precio → 3 avisos → «Marcar todos como leídos» (una petición) → persiste al recargar. |
| 6 · Comparador de coste | Probado (local) | Cada candidatura se calcula en su destino y con su ruta, sin modificar el viaje (`candidateScenario`). Forfait, peajes, parking y alquiler solo se reutilizan si la candidatura es de la estación del viaje. Si no, quedan pendientes con la razón, salvo que no apliquen (paquete con forfait, sin coches, nadie alquila). El presupuesto elegido mantiene la validación estricta de destino. Tests: dos estaciones, viaje sin destino, viaje sin destino con coche, condiciones incompatibles y partidas pendientes. e2e en tres anchos. |
| 7 · E2E sin `.dev.vars` | Probado (local, copia limpia) | Ver la sección anterior. GitHub Actions real sin ejecutar. |

Error encontrado durante la corrección que no estaba en la lista: el historial de precios de un producto devolvía solo la primera sustitución de formato (la consulta del bucle no leía `replaced_by`) y hacía una consulta por salto. Ahora es una sola sentencia recursiva y hay un test con 10 sustituciones.

## Criterio de frescura de la nieve

- **Captura** (`observedAt`): cuándo la descargamos. **Parte** (`sourceDate`): la fecha que publica la fuente.
- Puntúa solo si se capturó hace 30 h o menos y, si la fuente publica fecha de parte, esa fecha es de hoy o de ayer.
- Una fecha de parte anterior a ayer no puntúa («el parte de la fuente es anterior a ayer») y no desplaza a otra fuente con parte reciente. Una fecha de parte futura se trata como dudosa.
- **Zona horaria:** las fechas de parte son fechas sin hora y se interpretan en Europe/Madrid. «Hoy» y «ayer» se calculan en Europe/Madrid (`todayMadrid`).
- **Limitación:** si la fuente no publica fecha de parte, solo cuenta la captura. Un parte viejo que la web siga mostrando sin fecha no se puede detectar. La interfaz lo dice: «la fuente no publica fecha de parte».
- Efecto en el extracto real de Grandvalira: su parte es del 23/09/2026, así que desde el 25/09/2026 no puntúa (`parte_antiguo`). Antes se excluía por estado desconocido. La expectativa del test se actualizó por esta regla nueva, con un comentario.

## Qué se corrigió en la revisión anterior

La revisión del mismo día (entrega 64c3642) sigue cubierta por sus tests: D1 Free, presupuesto por condiciones, atomicidad, identidad y tipo de precio de ofertas, compra y cesta, capacidades honestas, ranking y coste, y legacy. Los detalles están en el historial de git y en `test/worker/review-fixes.test.ts`.

## Solo local, sin test automático

- **Recolectores con fixtures contra `wrangler dev` y una D1 local aislada** (30/09/2026):
  - nieve con el fixture sintético de Esquiades: 21 fuentes, 9 válidas, 8 filas escritas;
  - ofertas con fixtures sintéticos: 19 fuentes, 62 observaciones;
  - Grandvalira con el extracto real: 1 fila.
- **Importador de hojas:** probado con las plantillas de `docs/templates`.
- **Copias de seguridad:** `backup.ts export --local` y `restore-test`.

## Pendiente online

- **Primera ejecución de los recolectores contra las webs reales.** Hasta entonces todas las fuentes figuran como «no verificada online». Para registrarlo hay un workflow manual de solo lectura (`v2 · comprobar fuentes online`, `tools/online-check.ts`).
- **Grandvalira oficial:** probado con un extracto de texto real obtenido con una herramienta de lectura web, no con el HTML crudo.
- **CPU de 10 ms:** no medido en Cloudflare (ver `QUOTAS.md`).
- **Workflows de GitHub Actions:** escritos, no ejecutados en GitHub.
- **Recuentos de sentencias en D1 remoto:** medidos solo en D1 local.

## Sin implementar

- **Búsqueda automática de ofertas por fechas y ocupación.** No está implementada: falta estudiar y verificar el formato de búsqueda de cada proveedor. No es una limitación de la fuente. La cotización manual y el enlace al proveedor son una alternativa, pero no equivalen al buscador automático pedido.
- **Precios de forfait, peajes, parking y alquiler por estación.** El presupuesto guarda un único importe por viaje. En el comparador, las estaciones distintas de la del viaje quedan pendientes en esas partidas.

## Pendiente de David

- **Push al repositorio:** la cuenta conectada no tiene permiso de escritura en `Lilru-tech/skitrip`. El trabajo se entrega como bundle de git.
- **Despliegue:** proyecto de Firebase (Spark) y cuenta de Cloudflare (Free) de David, y su visto bueno. Pasos en `DEPLOY.md`, con las migraciones 0001–0008. Esta corrección no añade migraciones.
- **Exportaciones de las hojas** (comentarios, compra, disponibilidad) en CSV.
- **Red del entorno de desarrollo:** para verificar fuentes desde aquí hay que permitir esos dominios en la configuración de red del entorno. Si no, se usa el workflow manual.

## Sin probar en la interfaz

- Lector de pantalla real (sí nombres y roles ARIA).
- Restablecimiento de contraseña con Firebase real.
- Acciones de administración con una cuenta de administrador (sí sus endpoints).
- La vista de disponibilidad legacy (sí su API).
- Los enlaces a proveedores llevan a la portada pública: la API no guarda URL de búsqueda.

## No soportado por la fuente

- **Ordino Arcalís (web oficial):** no publica kilómetros.
- **Ax 3 Domaines (web oficial):** no publica km ni recuentos en texto.
- **Font-Romeu (Altiservice):** fuera de temporada solo muestra pistas de verano; revalidar en invierno.
- **Grandvalira fuera de temporada:** publica «0 / 215 km» sin texto de estado. Se guarda como estado desconocido y no puntúa.
- **Históricos hoteleros legacy:** sin hotel, noches, fechas ni ocupación; solo sirven como referencia agregada.
- **Open Prices:** cobertura muy escasa de productos de Mercadona en España.
- **Mercadona:** sin autorización; no hay precios automáticos y el adaptador directo sigue deshabilitado.
