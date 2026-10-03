# SkiTrip v2

Planificador de viajes de esquí para un grupo pequeño que sale de Tarragona: comparar estaciones y alojamiento, calendario compartido de disponibilidad, viajes con candidaturas y votos, presupuesto honesto, lista de la compra y gastos compartidos. Coste operativo: 0 € (Cloudflare Workers Free + D1, Firebase Auth Spark, GitHub Actions).

La web legacy (raíz del repositorio, GitHub Pages) sigue intacta durante la transición.

## Documentación

- [docs/PLAN.md](docs/PLAN.md): decisiones y fases.
- [docs/DEPLOY.md](docs/DEPLOY.md): despliegue, cuotas y cómo se evita cualquier cargo.
- [docs/SOURCES.md](docs/SOURCES.md): matriz de fuentes (generada desde `data/catalog.json`).
- [docs/MIGRATION.md](docs/MIGRATION.md): migración desde el legacy y vuelta atrás.
- [docs/VALIDATION.md](docs/VALIDATION.md): qué está probado, qué es solo local y qué falta.

## Requisitos

Node 22, npm y Java 21 (lo necesita el emulador de Firebase Auth). Nada más: todo corre en local con los emuladores oficiales, sin cuentas.

## Instalación y desarrollo

```bash
cd v2
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local                       # D1 local en .wrangler/
npx tsx tools/import-legacy.ts --apply local   # catálogo + históricos legacy (opcional)

# tres terminales
npm run emulators      # Firebase Auth emulator en 127.0.0.1:9099
npm run dev:api        # Worker + D1 local en localhost:8787
npm run dev            # SPA en localhost:5173 (usa el emulador automáticamente)
```

## Comprobaciones

```bash
npm run typecheck
npm test               # lógica pura + Worker con D1 real en workerd (Vitest)
npm run e2e            # Playwright a 360 px, 390 px y escritorio (levanta emulador, Worker y Vite)
npm run demo:e2e       # recorrido mínimo registro → sesión → D1 → rechazo a otro usuario
```

Los tests nunca escriben en producción: usan D1 en memoria o en `test/e2e/.state`, y el emulador de Auth.

## Herramientas

| Comando | Para qué |
|---|---|
| `npx tsx tools/import-legacy.ts --dry-run \| --apply local\|remote` | Importa catálogo e históricos legacy con hashes e informe de anomalías. |
| `npx tsx tools/import-sheets.ts --kind … --file … --dry-run` | Importa CSV exportados de las hojas (comentarios, compra, disponibilidad). |
| `npx tsx tools/backup.ts export --local\|--remote` / `restore-test <dir>` | Copia de seguridad y prueba de restauración. |
| `npm run collect:snow` / `npm run collect:offers` | Recolectores (los ejecuta GitHub Actions; en local aceptan `--fixture`/`--dry-run`). |
| `npx tsx tools/gen-sources-doc.ts` | Regenera `docs/SOURCES.md`. |

## Estructura

```
src/core/      lógica pura (fechas, calendario, repartos, presupuesto, análisis, parsers)
src/worker/    API Hono en Cloudflare Workers (auth, permisos, rutas)
src/web/       SPA React
migrations/    esquema D1 versionado
data/          catálogo curado (estaciones, rutas, fuentes)
tools/         importadores, copias, recolectores
test/          tests de core, Worker y e2e; fixtures sintéticos
```

## Reglas que no se rompen

- Mercadona: sin autorización, el adaptador directo está deshabilitado y no se sustituye por proxy ni extensión.
- «Sin indicar» nunca cuenta como libre en el calendario.
- Un precio orientativo «desde» nunca se presenta como precio para las fechas de un viaje.
- Ningún secreto en el cliente ni en el repositorio; los datos privados solo en D1.
