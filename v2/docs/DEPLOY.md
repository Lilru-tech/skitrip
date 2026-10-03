# Publicación (coste 0 €)

**Arquitectura publicada**

- **Interfaz:** GitHub Pages en `https://lilru-tech.github.io/skitrip/`, la misma URL de la web antigua, sin redirección. Rutas con fragmento (`/skitrip/#/viajes`).
- **API:** Cloudflare Worker en `https://skitrip.<subdominio>.workers.dev`. CORS solo para el origen exacto `https://lilru-tech.github.io`.
- **Datos:** D1 (Cloudflare).
- **Autenticación:** Firebase Authentication, plan Spark.
- **Recolectores y despliegues:** GitHub Actions.

Estado a 01/10/2026: **nada de esto se ha ejecutado todavía en las cuentas reales.** Faltan los accesos descritos en `ACCESOS.md`, entregado en la carpeta del proyecto. Un workflow omitido por falta de secretos no cuenta como probado.

## Qué se usa y qué cuesta

| Servicio | Plan | Límite relevante | Al superarlo |
|---|---|---|---|
| GitHub Pages | Repositorio público | 1 GB de sitio, 100 GB/mes de tráfico (límite blando) | GitHub avisa. No factura. |
| GitHub Actions | Repositorio público | Runners estándar gratuitos | — |
| Cloudflare Workers | Free | 100.000 peticiones/día, 10 ms de CPU por petición | Error 1027 hasta el día siguiente. No factura. |
| Cloudflare D1 | Free | 5 GB en total, 5 M filas leídas y 100.000 escritas al día, 50 consultas por invocación | Errores de consulta hasta el día siguiente. No factura. El Worker se corta a 40 consultas (ver `QUOTAS.md`). |
| D1 Time Travel | Incluido en Free | Restauración a cualquier minuto de los últimos 7 días | — |
| Firebase Authentication | Spark | 50.000 usuarios activos/mes con correo y contraseña | Spark no admite facturación. |

Límites publicados por cada servicio, consultados el 30/09/2026.

**No hacer nunca:**

- pasar Firebase a Blaze ni activar Identity Platform;
- contratar Workers Paid;
- añadir una tarjeta «por si acaso»;
- usar un dominio de pago.

Sin método de pago, un servicio gratuito se bloquea al llegar al límite; no puede cobrar.

**Comprobar que sigue gratis:**

- Cloudflare → Manage account → Billing: solo «Workers Free» y ningún método de pago.
- Firebase: la consola dice «Spark» abajo a la izquierda y no hay cuenta de facturación.
- GitHub → Settings → Billing: 0 $.

## Configuración (una vez; lo hace David)

Los pasos con enlaces están en `ACCESOS.md`. Resumen de qué va dónde:

| Nombre | Tipo en GitHub (Settings → Secrets and variables → Actions) | Contenido |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Secret** | Token con la plantilla «Edit Cloudflare Workers» más D1 Edit, solo de esta cuenta |
| `CLOUDFLARE_ACCOUNT_ID` | **Secret** | ID de la cuenta de Cloudflare |
| `SKITRIP_INGEST_TOKEN` | **Secret** | Cadena aleatoria larga: credencial de los recolectores |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` | Variable | Configuración web de Firebase. Es pública: va en el JavaScript de la web. |
| `VITE_API_BASE_URL` | Variable | `https://skitrip.<subdominio>.workers.dev`, sin barra final ni ruta |

Para generar el secreto de ingesta **sin que aparezca en pantalla ni en registros**, cópialo directamente al portapapeles y pégalo en el formulario de GitHub:

```bash
openssl rand -base64 32 | tr -d '\n' | pbcopy        # macOS
openssl rand -base64 32 | tr -d '\n' | xclip -sel c  # Linux
```

No hace falta guardarlo en ningún otro sitio. El workflow lo copia al Worker leyendo de stdin (`wrangler secret put`), sin imprimirlo. Para rotarlo, genera uno nuevo, sustitúyelo en GitHub y vuelve a lanzar «v2 · publicar» (con «API» marcado).

En Firebase → Authentication → Settings → Dominios autorizados debe estar `lilru-tech.github.io`. Sin él, el alta y el acceso fallan desde Pages.

## Workflows

Todos están en `.github/workflows/` de la raíz del repositorio. Todos ejecutan sus pasos con `shell: bash`, es decir, `bash -eo pipefail`: si falla un comando dentro de una tubería (`… | tee`), falla el paso. Ojo: un `defaults.run` dentro de un job sustituye entero al del workflow, así que si fija `working-directory` debe repetir `shell: bash`. `npm run test:workflows` lo comprueba ejecutando los pasos críticos con un artefacto roto y otro válido.

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `v2-verify.yml` | Lo llaman los dos siguientes | Batería completa de UN commit: comprueba que ha sacado ese SHA, typecheck, Vitest, pruebas de los workflows (`npm run test:workflows`), build normal, build de Pages con verificación del artefacto y Playwright contra emuladores. Sin secretos y con permisos de lectura. |
| `v2-ci.yml` | Push a ramas que no son `main` y PR | Llama a `v2-verify.yml`. Las PR se prueban con `pull_request` (sin secretos ni escritura), nunca con `pull_request_target`. |
| `v2-release.yml` («v2 · publicar») | Push a `main` que toque `v2/`, `data/*.json` o los workflows, y manual (casillas «API» y «Pages») | Solo desde `main`. En orden y para el mismo SHA: **1)** `v2-verify.yml`; **2)** API, si toca: D1, marcador de Time Travel (sin marcador no migra), migraciones, catálogo e históricos, Worker, secreto de ingesta y comprobación en vivo (salud, CORS de Pages, otros orígenes rechazados, 401 sin token); **3)** Pages, si toca y la API terminó bien o no tocaba: build con las variables públicas, verificación del artefacto (solo `index.html`, `assets/` y `favicon.svg`), publicación **solo si la fuente de Pages es «GitHub Actions»**, y comprobación de la portada, el meta CSP, un recurso JS y las cabeceras reales. Un manual pasa por las mismas pruebas. |
| `v2-prod-check.yml` («v2 · comprobar producción») | Manual | Recorrido real con Playwright en `https://lilru-tech.github.io/skitrip/` contra la API y Firebase de producción: alta y acceso, salida, privacidad (401 sin token, 403/404 a un tercero), amistad, calendario compartido, viaje e invitación, compra y gasto con saldos que suman 0, sin errores de CSP o CORS. Crea 3 cuentas `prod-check-<ejecución>-…@example.com`; al final borra su viaje y sus cuentas de Firebase, pero el perfil en D1 queda y ocupa 3 de los `MAX_PROFILES`. |
| `v2-admin.yml` | Manual | Da o quita el rol de administración por **UID real de Firebase**. |
| `v2-snow.yml` | Dos veces al día de diciembre a abril; los lunes el resto del año | Estado de pistas → `/api/ingest/snow`. |
| `v2-offers.yml` | Diario de octubre a abril; los lunes el resto del año | Precios orientativos de catálogo → `/api/ingest/offers`. Las búsquedas por fechas quedan «no soportadas» porque el robots.txt de Esquiades (`/book/`) y el de Estiber (`/csp/online/`) prohíben su buscador. |
| `v2-online-check.yml` | Manual | Comprobación de fuentes en solo lectura. Por fuente distingue transporte, extracción, «sin datos» legítimo, estructura incompatible, bloqueo y robots. Con «fixtures» guarda fragmentos reducidos y saneados de cada página, que pasan a `test/fixtures/real/`. |
| `update-data.yml` | El de la web antigua | Sigue igual hasta el paso 7. |

Los recolectores usan `VITE_API_BASE_URL` como dirección de la API. Si les falta configuración, terminan con un aviso y no escriben nada. Ante un desafío real (CAPTCHA, página de verificación), un 403 o un 429 se detienen y lo registran; no lo evaden. Un script auxiliar de reCAPTCHA en una página con contenido normal no es un bloqueo (`src/core/blocked.ts`). También respetan el robots.txt en cada petición que haga la página al renderizarse.

## Procedimiento de publicación

Cada paso dice cómo se comprueba. No se pasa al siguiente con el anterior en rojo.

1. **Conservar la web antigua.** No se borra ni se mueve nada de la raíz del repositorio. La web antigua sigue en la rama y carpeta que hoy usa Pages, y las hojas, el Apps Script y los históricos no se tocan. Anota la fuente actual de Settings → Pages: es la vuelta atrás.
2. **Fusionar `rebuild/v2`** en `main` mediante una PR con la CI en verde. La fusión lanza «v2 · publicar»: repite las pruebas sobre ese commit y, sin los secretos de Cloudflare, se para en la etapa de la API («Falta configuración») sin tocar Pages. Mientras Pages siga publicando desde la rama, la etapa de Pages compila y verifica pero no publica: la web antigua sigue visible.
3. **Desplegar la API:** Actions → «v2 · publicar» → Run workflow (rama `main`, «API» marcada). Primero pasa la batería completa de ese commit.
   - El resumen muestra la URL de workers.dev, el marcador de Time Travel y «Comprobación en vivo correcta».
   - Pon esa URL en la variable `VITE_API_BASE_URL`.
4. **Catálogo e históricos de la web antigua.** Los importa el mismo workflow del paso 3 (`tools/import-legacy.ts`): catálogo curado, histórico de km y de precios de hotel, con su copia íntegra y su hash. Es reejecutable y no duplica. El resumen muestra los totales y el commit de origen.
5. **Publicar la interfaz.** En Settings → Pages → Build and deployment → Source, elige **GitHub Actions**. Lanza «v2 · publicar» con «Pages» marcado (y «API» también si quieres repetirla; el orden es siempre pruebas → API → Pages).
   - El job publica y comprueba `https://lilru-tech.github.io/skitrip/`: portada 200, CSP en meta y recursos bajo `/skitrip/assets/`.
   - Lanza «v2 · comprobar producción»: es la verificación automática en la URL final.
   - Prueba a mano: alta, salida, acceso, restablecer contraseña (llega el correo de Firebase en español), crear un viaje y abrir un enlace de invitación en otra sesión.
6. **Primer acceso y administración.**
   - Date de alta en `https://lilru-tech.github.io/skitrip/`.
   - Copia tu UID de Firebase → Authentication → Users.
   - Lanza «v2 · administración» con ese UID y el rol `admin`. Al recargar la web aparece «Administración».
   - Nunca se da el rol por alias: un alias no prueba identidad.
7. **Importar la hoja antigua.** En Administración → «Importar la hoja antigua (CSV)», sube cada pestaña exportada.
   - Primero la vista previa con recuentos y errores; después importar. Repetirlo no duplica.
   - Los comentarios no se publican y la disponibilidad no se asigna: se hace persona a persona, y cada persona incorpora sus días si quiere.
   - Alternativa por línea de comandos: `tools/import-sheets.ts`. Usa los mismos identificadores, así que las dos vías son idempotentes entre sí.
8. **Recolectores.**
   - Lanza «v2 · comprobar fuentes online». Revisa el registro y marca como `verified` en `data/catalog.json` solo las fuentes con extracción correcta.
   - Lanza a mano `v2-snow` y `v2-offers` y comprueba en Administración que hay capturas.
   - **Solo después** desactiva el workflow antiguo: Actions → `update-data.yml` → «Disable workflow». No se borra.
9. **Medir el uso real** con el panel de Cloudflare (peticiones, CPU y filas de D1 de un día normal) y anotarlo en `QUOTAS.md`.

## Vuelta atrás

- **Interfaz:** Settings → Pages → Source → «Deploy from a branch» con la rama y carpeta anotadas en el paso 1. La web antigua vuelve a estar en la misma URL en uno o dos minutos. No borra nada, y la API nueva sigue funcionando aparte.
- **API:** `npx wrangler rollback` (o Workers → skitrip → Deployments → «Rollback») vuelve a la versión anterior del Worker.
- **Datos:** D1 Time Travel restaura la base al marcador anotado por el despliegue, o a cualquier minuto de los últimos 7 días:
  ```bash
  npx wrangler d1 time-travel restore skitrip --bookmark=<marcador del resumen del workflow>
  ```
  Una migración aplicada no se deshace sola: restaurar el marcador anterior a la migración es la forma de deshacerla.
- **Recolector antiguo:** si se desactivó, Actions → `update-data.yml` → «Enable workflow».

## Cabeceras y CSP en Pages

GitHub Pages no permite cabeceras propias. Lo que se hace y lo que no:

- **CSP en `<meta http-equiv>`** con `default-src 'self'`, `script-src 'self'`, `connect-src` limitado a la API y a Firebase Auth, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` y `frame-src 'none'`. La e2e del build de Pages comprueba que no hay violaciones, incluida la lectura de tickets en PDF con su worker.
- **Lo que un `<meta>` no puede aplicar:** `frame-ancestors` (no hay protección contra incrustación en iframes), `report-uri`/`report-to` y `sandbox`. Tampoco se pueden fijar `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`. GitHub Pages envía de serie HTTPS y HSTS; el workflow guarda en el resumen las cabeceras reales que devuelve, para no suponerlas.
- **La API** (Worker) sí envía sus cabeceras: CORS exacto sin credenciales de navegador, `X-Content-Type-Options` y demás, según `src/worker/index.ts`.

## Mantenimiento

- **Workflows programados:** GitHub desactiva los programados tras 60 días sin actividad en un repositorio público. Si pasa: Actions → el workflow → «Enable workflow».
- **Estado de las fuentes:** Administración y `GET /api/public/sources` muestran el último intento, el último éxito y el error.
- **Copias:** D1 Time Travel cubre 7 días. Para una copia más larga, `npx tsx tools/backup.ts export --remote` en el equipo de David, y `restore-test` para comprobarla. Contiene datos privados: nunca se sube al repositorio ni se guarda como artefacto de Actions, porque en un repositorio público son descargables.
- **Bloquear a alguien:** Administración → Cuentas. El bloqueo es inmediato.
