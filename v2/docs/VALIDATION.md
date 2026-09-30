# Validación

Fecha: 30/09/2026. Rama `rebuild/v2`. Todo lo que aparece aquí se ha ejecutado en el entorno de desarrollo, que no tiene salida a las webs de estaciones, Esquiades, Estiber ni Open Prices, y no tiene cuentas de Cloudflare ni Firebase. Por eso las categorías son estrictas:

- **Implementado y probado:** hay un test automático que pasa.
- **Solo local:** funciona contra servicios locales oficiales (workerd + D1 local, emulador de Firebase Auth) o fixtures, pero no se ha ejecutado contra el servicio real.
- **Pendiente de credenciales o exportaciones:** listo, pero necesita algo de David.
- **No soportado por la fuente:** la fuente no publica el dato; no se inventa.

## Resultados de las pruebas

| Suite | Tests | Resultado |
|---|---|---|
| Lógica pura (`test/core`): calendario, repartos, presupuesto, análisis, puntuación, geografía, importadores de hojas | 35 | ✔ |
| Parsers con fixtures sintéticos (`test/core/parsers`): importes, nieve, ofertas, ticket, precio unitario | 74 | ✔ |
| Worker + D1 en workerd (`test/worker`): autenticación, permisos, calendario, viajes, gastos, compra, ingesta, administración | 56 | ✔ |
| **Total Vitest** | **165** | **✔ 165/165** |
| Typecheck (`tsc`) | — | ✔ |
| Recorrido mínimo (`npm run demo:e2e`): emulador Auth + `wrangler dev` + D1 local | 12 comprobaciones | ✔ |

| Playwright (`npm run e2e`) a 360 px, 390 px y 1280 px contra emulador Auth + Worker + D1 local | 45 (15 por tamaño) | ✔ 45/45 |
| Build de la SPA (`vite build`) | — | ✔ (unos 518 kB de JS, la mayor parte el SDK de Firebase; sin scripts ni estilos en línea) |

Recorridos e2e: registro y alias, amistad, compartir, marcar días, crear viaje e invitar, ventana común con ambos libres, proponer y votar fechas; gasto de 10 € entre tres con saldos que suman 0; editar y marcar un artículo de la compra y comprobar que persiste; votar y cambiar el voto de una candidatura; filtro de distancia de Comparar (dominios sin duplicar, estaciones sin ruta en su propio grupo); ofertas filtradas por modalidad; contraseña errónea; ausencia de emails ajenos; sin desbordamiento horizontal en 14 páginas; calendario usable solo con teclado; foco devuelto al cerrar diálogos; patrón semanal con excepción.

Sin probar en la interfaz: lector de pantalla real (sí nombres y roles ARIA), restablecimiento de contraseña con Firebase real, la página de administración con una cuenta de administrador (sí sus endpoints en la API), acciones de administración de miembros y el diálogo de conflicto de versión (el 409 sí está probado en la API). Comparar no puntúa el coste (el catálogo no tiene coste por estación) ni el après; la página lo indica.

## Implementado y probado

- **Cuentas:** alta con email, contraseña y alias público único (3–24 caracteres, sin distinguir mayúsculas ni acentos), sin verificación obligatoria; tope de perfiles y límite de altas por IP; bloqueo inmediato; los tokens se verifican contra las claves públicas de Firebase (firma, emisor, audiencia, caducidad, `auth_time`); tokens manipulados o de otro proyecto se rechazan.
- **Permisos:** quien no es miembro de un viaje recibe 404 (no se revela que existe); nadie edita contenido ajeno cambiando un ID; la búsqueda de personas nunca devuelve emails; un bloqueo oculta a la persona y anula el acceso a la disponibilidad por cualquier ruta.
- **Amigos e invitaciones:** solicitudes, aceptación automática de solicitudes cruzadas, invitaciones directas solo a amigos y enlaces de invitación guardados como hash, revocables.
- **Calendario compartido:** estados libre, ocupado, quizá y sin indicar; «sin indicar» nunca cuenta como libre; compartir con amigos o con un viaje; ventanas candidatas que incluyen día de llegada y de salida, con y sin «quizá»; propuestas de fechas y votos.
- **Ediciones simultáneas:** columnas de versión; una edición basada en datos viejos devuelve 409 en lugar de pisar la otra.
- **Presupuesto honesto:** cada partida es conocida, pendiente o no aplicable; un paquete con forfait no suma el forfait dos veces; noches, personas o días de forfait que no cuadran dejan el alojamiento pendiente en lugar de multiplicar; sin km de carretera, el transporte queda pendiente.
- **Gastos:** céntimos enteros, reparto exacto con el residuo asignado de forma determinista, saldos, transferencias sugeridas, liquidaciones, historial de cambios y borrado lógico.
- **Compra:** productos exactos con cantidad neta y unidad, lista versionada, precios manuales, CSV y ticket de texto con previsualización y confirmación re-analizada en el servidor; un ticket confirmado puede generar un gasto una sola vez.
- **Open Prices:** capa separada con atribución ODbL, caché de 7 días y conservación del último resultado si la API falla (probado con un cliente simulado).
- **Mercadona:** el adaptador directo existe solo como registro deshabilitado; hay un test que comprueba que no se activa.
- **Ingesta:** credencial propia comparada en tiempo constante (una sesión de usuario no sirve); cada fuente solo escribe en su ámbito; idempotencia por hash; un 0 dudoso no se guarda como cerrado; totales incoherentes se marcan; una captura vacía es un error visible y no borra el último dato válido; avisos de cambio de precio deduplicados por oferta y día.
- **Ofertas de catálogo:** se guardan como orientativas, sin escenario, y el detalle público solo muestra las de los últimos 14 días con su aviso.
- **Legacy:** importación idempotente con SHA-256 y copia íntegra; restauración verificada (4.432 filas hoteleras y 5.337 de nieve, hashes originales coinciden); disponibilidad y comentarios legacy solo se asignan a una cuenta por acción de administración.
- **Importadores de hojas:** CSV con «,» o «;», coma decimal, comillas y BOM; fechas D/M/AAAA, ISO e instantes de Apps Script convertidos a la fecha de Madrid; duplicados detectados; los días ausentes de la hoja no se inventan.

## Solo local

- **Recolector de nieve:** ejecutado contra `wrangler dev` con el fixture sintético de Esquiades: 9 fuentes con fila, 11 sin fila en el fixture (esperado), 1 rechazada por el servidor (Javalambre, abiertos > totales). No se ha ejecutado contra esquiades.com.
- **Recolector de ofertas:** ejecutado contra `wrangler dev` con fixtures sintéticos de Esquiades y Estiber: 19 fuentes, 62 observaciones. No se ha ejecutado contra las webs reales.
- **Importador de hojas:** probado con las plantillas de `docs/templates`, aplicado dos veces sobre D1 local sin duplicar filas.
- **Copias de seguridad:** `backup.ts export --local` y `restore-test` probados; `--remote` no.
- **Workflows de GitHub Actions:** escritos, no ejecutados (se ejecutarán cuando la rama llegue al repositorio).

## Pendiente de credenciales o exportaciones

- **Despliegue:** proyecto de Firebase (Spark) y cuenta de Cloudflare (Free) de David, y su visto bueno. Pasos en `DEPLOY.md`.
- **Push al repositorio:** la cuenta conectada no tiene permiso de escritura en `Lilru-tech/skitrip`. Mientras tanto el trabajo se entrega como bundle de git.
- **Exportaciones de las hojas** (comentarios, compra, disponibilidad) en CSV.
- **Primera ejecución online de los recolectores:** hasta entonces todas las fuentes figuran como «no verificada online».
- **Búsquedas de ofertas para las fechas de un viaje:** falta verificar a mano el formato de URL de búsqueda por fechas y ocupación de cada proveedor. Hasta entonces los escenarios se informan como «no soportado», nunca con precios de catálogo.

## No soportado por la fuente

- **Ordino Arcalís (web oficial):** no publica kilómetros.
- **Ax 3 Domaines (web oficial):** no publica km ni recuentos en texto.
- **Font-Romeu (Altiservice):** fuera de temporada solo muestra pistas de verano; revalidar en invierno.
- **Históricos hoteleros legacy:** sin hotel, noches, fechas de estancia ni ocupación; solo sirven como referencia agregada.
- **Open Prices:** cobertura muy escasa de productos de Mercadona en España.
- **Mercadona:** sin autorización; no hay precios automáticos.
