# SkiTrip v2 — plan breve y decisiones

Fecha: 30/09/2026. Rama: `rebuild/v2`. Remoto revisado: `d173625` (sin avances desde la auditoría; 306 commits, 19 estaciones, 4.432 observaciones hoteleras 16/12/2025–29/09/2026, 5.337 de km). El código de la copia local de enero es idéntico al remoto salvo los tres JSON: no hay cambios del usuario que conservar aparte.

## Estado de partida y bloqueos

| Tema | Estado |
|---|---|
| Push a `Lilru-tech/skitrip` | **Bloqueado**: la cuenta conectada no tiene permiso de escritura. Trabajo en local y entrego copia en la carpeta del proyecto hasta tenerlo. |
| Red del entorno | Los programas de este entorno solo alcanzan registros de paquetes (npm/pypi); estaciones, Esquiades, Estiber y Open Prices están bloqueadas para scripts. Puedo leer páginas sueltas para documentarme, pero **no ejecutar extractores ni smoke tests online** aquí. Los adaptadores se prueban con fixtures y quedan marcados «no verificado online» hasta que corran en GitHub Actions. |
| `INFORME-SKITRIP.md` | No está en la copia compartida; uso el resumen del encargo. |
| Exportaciones de Sheets (comentarios, compra, calendario) | Pendientes: importadores y plantillas listos, sin datos. |
| Credenciales Firebase / Cloudflare | No necesarias para la fase local (emuladores oficiales). Se piden solo para desplegar. |

## Cuotas comprobadas hoy (docs oficiales)

- Workers Free: 100.000 peticiones/día, **10 ms CPU**/petición, 50 subpeticiones, 5 cron por cuenta. Al superar: error 1027, no factura.
- D1 Free: **500 MB por base**, 5 GB por cuenta, 10 bases, 50 consultas por invocación, 5 M filas leídas y 100.000 escritas por día. Al superar: errores, no factura.
- Firebase Spark: 50.000 MAU en auth estándar, sin método de pago.
- GitHub Actions: gratis en repos públicos con runners estándar; sin método de pago el uso se bloquea al agotar cuota.

## Decisiones (resueltas por mí; cámbialas si no encajan)

1. **Ubicación**: la v2 vive en `v2/` del mismo repo. La raíz legacy queda intacta y GitHub Pages sigue sirviéndola durante la transición.
2. **Stack**: Vite + TypeScript + React (SPA estática) y un único Worker con Hono que sirve estáticos y `/api`. React porque la v2 añade muchas vistas con estado (calendario, viaje, gastos, compra); la lógica útil legacy (catálogo, históricos) se migra a datos, no se copia su UI.
3. **Auth**: Firebase Auth email+contraseña; sin verificación obligatoria. Token Bearer del SDK en cabecera (nunca en URL), verificado en el Worker con `jose` contra las JWKS oficiales de `securetoken` con caché, comprobando `iss`, `aud`, `exp`, `iat`, `auth_time`, `sub`. Modo emulador solo si `AUTH_MODE=emulator` y el host es local; el despliegue lo rechaza.
4. **Revocación**: estado de usuario en D1 (`active`/`blocked`) y `tokens_valid_after` comprobados en cada petición; los ID tokens caducan en 1 h. No hace falta Admin SDK en el Worker.
5. **Alta limitada**: el perfil (alias) se crea en D1 tras el registro Firebase; tope configurable de perfiles (`MAX_PROFILES`, 50) y límite por IP con contadores en D1 (consistentes en despliegue distribuido). Sin perfil no hay acceso a nada.
6. **Seguridad web**: misma origen para web y API, CORS con lista explícita, CSP estricta, cuerpos ≤ 64 KB, consultas parametrizadas y validación con `zod`.
7. **Datos**: migraciones SQL versionadas de D1; importes en céntimos enteros; cantidades con unidad explícita; fechas de calendario `YYYY-MM-DD` locales; instantes UTC mostrados en Europe/Madrid. Versión por fila (`version`) para detectar ediciones simultáneas.
8. **Legacy**: importación a tablas `legacy_*` separadas con hash SHA-256 y recuentos del fichero original, `--dry-run`, informe de anomalías e idempotencia. Nunca se mezcla con series nuevas. Ax 3 Domaines y Port del Comte se marcan con su cobertura real.
9. **Estaciones**: modelo `area` (estación, sector o dominio) con relaciones `member_of`; La Molina/Masella/Alp 2500, Astún/Candanchú/conjunto y Formigal/Panticosa/conjunto separados. La serie de 101 km de Astún/Candanchú se asigna al dominio conjunto, no a los miembros.
10. **Scrapers**: fuera del Worker, en GitHub Actions, con parsers puros y fixtures. Ingesta por lotes a `/api/ingest` con credencial propia (no sesiones de usuario). Nieve, hoteles y precios en workflows independientes. Durante la transición el workflow legacy sigue igual.
11. **Distancias**: rutas por carretera curadas con fuente y fecha; openrouteservice opcional con clave y caché. Haversine solo como «estimación geográfica».
12. **Mercadona**: adaptador directo **deshabilitado**. Compra con productos exactos, precios manuales/CSV/ticket de texto con revisión previa, y Open Prices como capa colaborativa separada con atribución ODbL.
13. **Gastos**: céntimos, residuo repartido de forma determinista por orden de miembro; liquidaciones manuales registradas.
14. **Tests**: Vitest para lógica pura y Worker+D1 (Miniflare/workerd), emulador Auth oficial para el recorrido real, Playwright para móvil 360/390 px y escritorio.

## Fases

1. **Demo mínima** (ahora): registro sin verificación → sesión → petición autenticada → fila en D1 → rechazo a otro usuario. Emulador Auth + D1 local, con test automático.
2. Modelo completo, migraciones e importador legacy con dry-run, informe y restauración.
3. Amigos, viajes, invitaciones y **calendario compartido** (función principal).
4. Estaciones/fuentes/nieve con parsers corregidos y matriz de fuentes.
5. Ofertas, escenarios, históricos y presupuesto honesto (sin multiplicadores).
6. Compra, precios y Open Prices; votos y gastos.
7. UI completa, accesibilidad, Playwright móvil/escritorio.
8. Despliegue a Cloudflare/Firebase (con tus credenciales y tu visto bueno), plan de cambio y rollback.
