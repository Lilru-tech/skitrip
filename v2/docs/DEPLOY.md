# Despliegue (coste 0 €)

Nada de esto se ha ejecutado todavía: requiere las cuentas de David y su visto bueno. Los pasos están pensados para que **no haya ningún método de pago registrado**: sin tarjeta, un servicio gratuito se bloquea al llegar a su límite y no puede facturar.

## Qué se usa y qué cuesta

| Servicio | Plan | Límite relevante | Qué pasa al superarlo |
|---|---|---|---|
| Cloudflare Workers | Free | 100.000 peticiones/día, 10 ms de CPU por petición, 5 cron por cuenta | Error 1027 hasta el día siguiente. No factura. |
| Cloudflare D1 | Free | 500 MB por base, 5 M filas leídas y 100.000 escritas al día; 50 consultas por invocación del Worker y 100 parámetros por sentencia | Errores de consulta hasta el día siguiente. No factura. El Worker se corta a 40 consultas por petición (ver `QUOTAS.md`). |
| Firebase Authentication | Spark | 50.000 usuarios activos al mes (email + contraseña) | No se pueden crear sesiones nuevas. Spark no admite facturación. |
| GitHub Actions | Repositorio público | Runners estándar gratuitos | — |
| Dominio | `*.workers.dev` | Subdominio gratuito | — |

Uso estimado para 10–20 personas: unos cientos de peticiones al día, dos capturas de nieve y una de ofertas diarias (unas 60 escrituras por captura), D1 muy por debajo de 50 MB en años. Las cifras de límites son las publicadas por cada servicio el 30/09/2026.

**No hacer nunca:** pasar Firebase a Blaze ni activar Identity Platform, suscribirse a Workers Paid, añadir tarjeta «por si acaso», usar un dominio propio de pago, activar Workers Logs de pago o R2/KV fuera de sus cuotas gratuitas.

## 1. Firebase (autenticación)

1. En https://console.firebase.google.com crea un proyecto (plan Spark, el predeterminado). Desactiva Google Analytics: no hace falta.
2. Authentication › Sign-in method: habilita **Correo electrónico/contraseña**. No actives «vínculo por correo».
3. Authentication › Settings › Authorized domains: añade `skitrip.<tu-subdominio>.workers.dev`.
4. Authentication › Templates: plantilla de restablecimiento de contraseña en español (el envío lo hace Firebase, gratis).
5. Configuración del proyecto › Tus apps › Web: registra una app y copia `apiKey`, `authDomain` y `projectId` a `v2/.env.production.local` (plantilla en `.env.example`). No son secretos.

No hace falta cuenta de servicio ni Admin SDK: el Worker verifica los tokens con las claves públicas de Google.

## 2. Cloudflare (Worker + D1)

```bash
cd v2
npx wrangler login                                  # abre el navegador; cuenta Free sin tarjeta
npx wrangler d1 create skitrip                      # copia el database_id a wrangler.jsonc
npx wrangler d1 migrations apply skitrip --remote   # crea las tablas (migraciones 0001–0008; la 0007 y la 0008 son de la revisión del 30/09/2026)
npx tsx tools/import-legacy.ts --dry-run            # revisa el informe (exports/legacy-import-report.json)
npx tsx tools/import-legacy.ts --apply remote       # catálogo + históricos legacy
```

En `wrangler.jsonc` ajusta `vars`:

- `FIREBASE_PROJECT_ID`: el ID del paso 1.
- `ALLOWED_ORIGINS`: `https://skitrip.<tu-subdominio>.workers.dev`.
- `MAX_PROFILES`: tope de perfiles (50 por defecto).
- `AUTH_MODE` debe ser `firebase`. El modo `emulator` solo funciona en localhost y se rechaza fuera.

Secreto de ingesta (lo usan los recolectores; no va al repositorio ni al cliente):

```bash
openssl rand -base64 32 | tee /dev/stderr | npx wrangler secret put INGEST_TOKEN
```

Construir y desplegar:

```bash
npm ci && npm test && npm run build
npx wrangler deploy
curl https://skitrip.<tu-subdominio>.workers.dev/api/health   # {"ok":true}
```

Administración: regístrate en la app con tu alias y date el rol a mano (no hay forma de hacerse admin desde la web):

```bash
npx wrangler d1 execute skitrip --remote --command "UPDATE users SET role = 'admin' WHERE alias_norm = 'tu-alias'"
```

El despliegue se hace desde el ordenador de David: así no hace falta guardar un token de Cloudflare en GitHub. Si más adelante se quiere desplegar desde Actions, crea un token con permiso solo de «Workers Scripts: Edit» y «D1: Edit» sobre esta cuenta y guárdalo como secreto del repositorio.

## 3. GitHub Actions (recolectores)

En el repositorio › Settings › Secrets and variables › Actions:

- `SKITRIP_API_URL` = `https://skitrip.<tu-subdominio>.workers.dev`
- `SKITRIP_INGEST_TOKEN` = el mismo valor de `INGEST_TOKEN`

Workflows (en la raíz del repositorio, `.github/workflows/`):

| Workflow | Frecuencia | Qué hace |
|---|---|---|
| `v2-snow.yml` | 2 al día de diciembre a abril, semanal el resto | Lee el estado de pistas y lo envía a `/api/ingest/snow`. |
| `v2-offers.yml` | Diario de octubre a abril, semanal el resto | Precios orientativos «desde» de las páginas de catálogo. Las búsquedas por fechas de un viaje quedan «no soportadas» hasta verificar el formato de URL de cada proveedor. |
| `v2-ci.yml` | En cada push/PR que toque `v2/` | Typecheck, tests, build y e2e contra emuladores. No usa secretos. |

Sin los secretos, los recolectores terminan en verde con un aviso y no hacen nada. Si una página devuelve CAPTCHA, 403 o 429, el recolector se detiene y lo registra; no reintenta ni evade. Los diagnósticos se guardan 3 días como artefacto.

El workflow legacy `update-data.yml` sigue funcionando igual hasta el cambio (ver `MIGRATION.md`).

## Mantenimiento

- **Workflows programados:** GitHub desactiva los programados tras 60 días sin actividad en un repositorio público. Si pasa, Actions › el workflow › «Enable workflow».
- **Estado de fuentes:** la pantalla de administración y `GET /api/public/sources` muestran el último intento, el último éxito y el error de cada fuente.
- **Copias:** `npx tsx tools/backup.ts export --remote` (solo lectura) antes de cada migración, y `restore-test` para comprobarla. Las copias contienen datos privados: guárdalas fuera del repositorio.
- **Rotar el secreto de ingesta:** `wrangler secret put INGEST_TOKEN` con un valor nuevo y actualiza el secreto de GitHub.
- **Bloquear a alguien:** `POST /api/admin/users/<id>/block` (y `/unblock`) con una sesión de administrador. El bloqueo es inmediato: el Worker comprueba el estado en cada petición.
