// Vigilancia ligera de producción (workflow «v2 · vigilar», diario): salud, errores, CPU, cuotas Free y edad de las
// capturas, con umbrales. Solo lee: una petición a /api/health, la analítica gratuita de Cloudflare y unas pocas
// consultas de recuento a D1. No exporta ni restaura nada (eso es «v2 · comprobar recuperación»).
//
// Cada comprobación sale como OK, AVISO o FALLO con lo que hay que hacer. La política de tools/watch-policy.ts guarda el
// estado por días en D1 (watch_findings, visible en Administración): aviso aislado, degradación repetida (abre un único
// aviso de GitHub con la etiqueta «vigilancia», que se cierra al recuperarse) o fallo real (el proceso sale con 1, el
// workflow queda en rojo y GitHub avisa por correo a quien lo tenga activado). Nada privado en el registro: recuentos,
// identificadores de fuentes y estados.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { graphql } from './cpu-summary';
import { classifySource, issueAction, issueMarker, nextState, type Finding, type Kind, type SourceRow } from './watch-policy';

const V2 = path.resolve(import.meta.dirname, '..');
const API = (process.env.PROD_API ?? '').replace(/\/$/, '');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const now = new Date(process.env.WATCH_NOW ?? Date.now());

type Level = 'OK' | 'AVISO' | 'FALLO';
const rows: { key: string; kind: Kind; level: Level; what: string; value: string; action: string }[] = [];
const add = (level: Level, what: string, value: string, action = '', key = `check:${what}`, kind: Kind = 'check') => rows.push({ key, kind, level, what, value, action });
const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);

function d1(sqlText: string): any[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', '--remote', '--json', '--command', sqlText], { cwd: V2, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out).flatMap((r: any) => r.results ?? []);
}
const fmtAge = (ms: number) => (ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : ms < 72 * 3600e3 ? `${(ms / 3600e3).toFixed(1)} h` : `${(ms / 864e5).toFixed(1)} días`);

/** Edad máxima aceptable de la última captura completada según la época (los workflows de captura van por cron). */
export function maxAgeHours(pipeline: 'snow' | 'offers', d: Date): number {
  const m = d.getUTCMonth() + 1;
  if (pipeline === 'snow') return m === 12 || m <= 4 ? 30 : 8 * 24;        // temporada: dos al día; fuera: lunes
  return m >= 10 || m <= 4 ? 30 : 8 * 24;                                   // oct-abr: diaria; may-sep: lunes
}

// 1) Salud de la API.
try {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/health`, { headers: { Origin: 'https://lilru-tech.github.io' } });
  const ms = Date.now() - t0;
  r.ok ? add(ms > 3000 ? 'AVISO' : 'OK', 'API /api/health', `HTTP ${r.status} en ${ms} ms`, ms > 3000 ? 'Lenta: repetir; si sigue, revisar el panel del Worker.' : '')
    : add('FALLO', 'API /api/health', `HTTP ${r.status}`, 'La API no responde bien: revisar el último despliegue de «v2 · publicar» y el panel del Worker.');
} catch (e) { add('FALLO', 'API /api/health', String((e as Error).message), 'La API no responde: revisar el último despliegue.'); }

// 2) Worker en las últimas 24 h (analítica gratuita).
try {
  const s = new Date(now.getTime() - 864e5).toISOString().replace(/\.\d+Z$/, 'Z'), u = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const w = (await graphql(`query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:50,filter:{scriptName:"skitrip",datetime_geq:$s,datetime_leq:$u}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99} dimensions{status}}}}}`, { a: ACCOUNT, s, u })).workersInvocationsAdaptive as any[];
  const total = w.reduce((a, r) => a + r.sum.requests, 0);
  const by = Object.fromEntries(w.map((r) => [r.dimensions.status, r.sum.requests]));
  const bad = total - (by.success ?? 0) - (by.clientDisconnected ?? 0);
  const cpuOut = (by.exceededCpu ?? 0) + (by.exceededResources ?? 0);
  const ok = w.find((r) => r.dimensions.status === 'success');
  const p50 = (ok?.quantiles.cpuTimeP50 ?? 0) / 1000, p99 = (ok?.quantiles.cpuTimeP99 ?? 0) / 1000;
  add(total > 80000 ? 'FALLO' : total > 50000 ? 'AVISO' : 'OK', 'Peticiones al Worker (24 h)', `${total} de 100.000/día`, total > 50000 ? 'Cerca del límite Free: buscar qué cliente o recolector repite peticiones.' : '');
  add(bad > 0 && bad / Math.max(total, 1) > 0.05 ? 'FALLO' : bad > 0 ? 'AVISO' : 'OK', 'Peticiones que fallaron en el Worker', `${bad} · ${w.map((r) => `${r.dimensions.status}×${r.sum.requests}`).join(' ') || 'sin tráfico'}`, bad > 0 ? 'Ver «Logs»/«Métricas» del Worker en el panel de Cloudflare para la hora del fallo.' : '');
  add(cpuOut > 0 ? 'FALLO' : 'OK', 'Cortes por CPU (exceededCpu/Resources)', String(cpuOut), cpuOut > 0 ? 'Alguna petición pasó de 10 ms y Cloudflare la cortó: lanzar «v2 · medir CPU» para ver qué ruta.' : '');
  add(p99 > 10 ? 'AVISO' : 'OK', 'CPU por petición correcta (24 h)', `p50 ${p50.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms (límite 10 ms)`, p99 > 10 ? 'El p99 supera 10 ms sin cortes (Free tolera ráfagas): lanzar «v2 · medir CPU» si se repite.' : '');
} catch (e) { add('AVISO', 'Analítica del Worker', String((e as Error).message).slice(0, 120), 'El token necesita «Account Analytics: Read».'); }

// 3) D1: tamaño y filas de 24 h frente a los límites Free.
try {
  const info = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'info', 'skitrip', '--json'], { cwd: V2, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  const mb = Number(info.database_size ?? 0) / 1e6, rr = Number(info.rows_read_24h ?? NaN), rw = Number(info.rows_written_24h ?? NaN);
  add(mb > 400 ? 'FALLO' : mb > 100 ? 'AVISO' : 'OK', 'Tamaño de D1', `${mb.toFixed(1)} MB de 500 MB`, mb > 100 ? 'Revisar qué tablas crecen (observaciones) y su retención.' : '');
  add(rr > 4e6 ? 'FALLO' : rr > 1e6 ? 'AVISO' : 'OK', 'Filas leídas en D1 (24 h)', `${rr.toLocaleString('es-ES')} de 5.000.000/día`, rr > 1e6 ? 'Alguna ruta o recolector lee demasiado: revisar «Métricas» de D1.' : '');
  add(rw > 80000 ? 'FALLO' : rw > 40000 ? 'AVISO' : 'OK', 'Filas escritas en D1 (24 h)', `${rw.toLocaleString('es-ES')} de 100.000/día`, rw > 40000 ? 'Las capturas escriben mucho: espaciar recolectores o reducir lotes.' : '');
} catch (e) { add('FALLO', 'D1', String((e as Error).message).slice(0, 120), 'No se pudo leer D1: revisar el token de Cloudflare.'); }

// 4) Perfiles, restos de pruebas, capturas y fuentes (consultas de recuento).
try {
  const [u] = d1(`SELECT COUNT(*) AS n, SUM(email GLOB 'prod-check-*@example.com' AND role = 'user') AS tests FROM users`);
  add(u.n >= 45 ? 'AVISO' : 'OK', 'Perfiles', `${u.n} de 50 (MAX_PROFILES)`, u.n >= 45 ? 'Cerca del máximo: nuevas altas fallarían.' : '');
  add(u.tests > 0 ? 'AVISO' : 'OK', 'Perfiles de pruebas sin limpiar', String(u.tests ?? 0), u.tests > 0 ? 'Lanzar «v2 · limpiar prueba de producción» con el id de ejecución que figura en su correo.' : '');
  for (const pipeline of ['snow', 'offers'] as const) {
    const [r] = d1(`SELECT status, started_at, finished_at, ok, failed, unsupported, rows_written FROM capture_runs WHERE pipeline = '${pipeline}' AND status <> 'running' ORDER BY started_at DESC LIMIT 1`);
    const [good] = d1(`SELECT MAX(finished_at) AS t FROM capture_runs WHERE pipeline = '${pipeline}' AND status IN ('ok','partial')`);
    const name = pipeline === 'snow' ? 'Captura de nieve' : 'Captura de ofertas';
    if (!good?.t) { add('FALLO', name, 'nunca ha terminado bien', `Lanzar «v2 · ${pipeline === 'snow' ? 'nieve' : 'ofertas'}» y revisar su registro.`); continue; }
    const age = now.getTime() - good.t, max = maxAgeHours(pipeline, now) * 3600e3;
    const last = r ? `última: ${r.status} (${r.ok} bien, ${r.failed} con error, ${r.unsupported} no compatibles, ${r.rows_written} filas)` : '';
    add(age > max ? 'FALLO' : r && r.status !== 'ok' ? 'AVISO' : 'OK', name, `última buena hace ${fmtAge(age)} (máx. ${fmtAge(max)}); ${last}`,
      age > max ? 'La captura programada no ha funcionado: revisar el workflow en Actions.' : r && r.status !== 'ok' ? 'Revisar las fuentes con error en Admin → Estado.' : '');
  }
  // Edad y cobertura de cada fuente prioritaria (nieve oficial y páginas de ofertas), con su propia racha.
  const prio = d1(`SELECT s.id, s.kind, s.area_id, s.status, h.last_attempt_at, h.last_success_at, h.last_status, h.reason, h.consecutive_fail
                   FROM sources s LEFT JOIN source_health h ON h.source_id = s.id
                   WHERE s.status IN ('verified','unverified') AND ((s.kind = 'snow' AND s.priority <= 10) OR s.kind = 'offers') ORDER BY s.kind, s.id`) as (SourceRow & { kind: 'snow' | 'offers' })[];
  for (const src of prio) {
    const c = classifySource(src, now.getTime(), maxAgeHours(src.kind, now) * 3600e3);
    add(c.level, `Fuente ${src.id}`, c.value, c.action, `source:${src.id}`, c.kind);
  }
  const failing = d1(`SELECT s.id, h.last_status, h.consecutive_fail FROM sources s JOIN source_health h ON h.source_id = s.id WHERE s.status IN ('verified','unverified') AND h.consecutive_fail >= 3 AND NOT ((s.kind = 'snow' AND s.priority <= 10) OR s.kind = 'offers') ORDER BY h.consecutive_fail DESC`);
  add(failing.length ? 'AVISO' : 'OK', 'Otras fuentes con 3+ fallos seguidos', failing.length ? failing.map((f) => `${f.id} (${f.last_status} ×${f.consecutive_fail})`).join(', ') : '0',
    failing.length ? 'Revisar si la web cambió de formato o bloquea; ver «v2 · comprobar fuentes online».' : '');
} catch (e) { add('FALLO', 'Consultas a D1', String((e as Error).message).slice(0, 120), 'No se pudo consultar D1.'); }

// Política por días (tools/watch-policy.ts) y avisos de GitHub sin duplicados.
const day = now.toISOString().slice(0, 10);
let prev = new Map<string, Finding>();
let persisted = false;
try { prev = new Map((d1('SELECT * FROM watch_findings') as Finding[]).map((f) => [f.key, f])); persisted = true; }
catch { add('AVISO', 'Estado de la vigilancia', 'no se pudo leer watch_findings', 'Comprobar que la migración 0014 está aplicada.'); }
const findings = rows.map((r) => ({ row: r, f: nextState(prev.get(r.key), { key: r.key, label: r.what, kind: r.kind, level: r.level, value: r.value }, day) }));

const GH = process.env.GITHUB_TOKEN, REPO = process.env.GITHUB_REPOSITORY, RUN = process.env.GITHUB_RUN_ID;
async function gh(method: string, url: string, body?: unknown) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${url}`, { method, headers: { Authorization: `Bearer ${GH}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`GitHub ${method} ${url}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}
const notes: string[] = [];
if (GH && REPO) {
  try {
    const open = new Map<string, number>();
    for (const i of (await gh('GET', '/issues?labels=vigilancia&state=open&per_page=100')) as { number: number; body: string | null }[]) {
      const m = /<!-- watch:(.+?) -->/.exec(i.body ?? '');
      if (m) open.set(m[1], i.number);
    }
    const runUrl = RUN ? `https://github.com/${REPO}/actions/runs/${RUN}` : '';
    for (const { row, f } of findings) {
      const openNo = open.get(f.key) ?? null;
      const act = issueAction(f, openNo);
      if (act === 'open') {
        if (!(await fetch(`https://api.github.com/repos/${REPO}/labels/vigilancia`, { headers: { Authorization: `Bearer ${GH}` } })).ok)
          await gh('POST', '/labels', { name: 'vigilancia', color: 'd93f0b', description: 'Degradación persistente o fallo detectado por «v2 · vigilar»' }).catch(() => undefined);
        const i = await gh('POST', '/issues', { title: `Vigilancia: ${f.label} ${f.state === 'fallo' ? 'falla' : 'degradada'}`, labels: ['vigilancia'],
          body: `${issueMarker(f.key)}\n**${f.state === 'fallo' ? 'Fallo real' : `Degradación: ${f.streak_days} días seguidos`}** desde ${f.first_seen}.\n\n- Valor: ${row.value}\n- Qué hacer: ${row.action || '—'}\n- Ejecución: ${runUrl}\n\nEste aviso se abre una vez y se cierra solo cuando la comprobación vuelve a OK (sin comentarios diarios).` }) as { number: number };
        f.issue_number = i.number; notes.push(`abierto aviso #${i.number} (${f.key})`);
      } else if (act === 'close') {
        await gh('POST', `/issues/${openNo}/comments`, { body: `Recuperado el ${day}: ${row.value}. ${runUrl}` });
        await gh('PATCH', `/issues/${openNo}`, { state: 'closed', state_reason: 'completed' });
        f.issue_number = null; notes.push(`cerrado aviso #${openNo} (${f.key})`);
      } else f.issue_number = openNo;
    }
  } catch (e) { notes.push(`avisos de GitHub no actualizados: ${(e as Error).message}`); }
} else notes.push('sin GITHUB_TOKEN: avisos de GitHub no gestionados (ejecución local)');

if (persisted) {
  try {
    const t = Date.now();
    const sql = findings.map(({ f }) => `INSERT INTO watch_findings (key,label,kind,state,streak_days,first_seen,last_day,last_value,issue_number,updated_at) VALUES (${[f.key, f.label, f.kind, f.state, f.streak_days, f.first_seen, f.last_day, f.last_value, f.issue_number, t].map(q).join(',')})
ON CONFLICT(key) DO UPDATE SET label=excluded.label, kind=excluded.kind, state=excluded.state, streak_days=excluded.streak_days, first_seen=excluded.first_seen, last_day=excluded.last_day, last_value=excluded.last_value, issue_number=excluded.issue_number, updated_at=excluded.updated_at;`);
    const keys = findings.map(({ f }) => q(f.key)).join(',');
    sql.push(`DELETE FROM watch_findings WHERE key NOT IN (${keys});`); // fuentes que dejaron de ser prioritarias
    const file = path.join(V2, 'watch-findings.sql');
    writeFileSync(file, sql.join('\n'));
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'skitrip', '--remote', '--file', file], { cwd: V2, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) { notes.push(`estado no guardado en D1: ${(e as Error).message.slice(0, 120)}`); }
}

const STATE_LABEL = { ok: 'OK', aislado: 'aviso aislado', degradado: 'DEGRADADO', fallo: 'FALLO' } as const;
console.log(`Vigilancia de producción · ${now.toISOString()}\n`);
console.log('| Estado | Comprobación | Valor | Días | Qué hacer |\n|---|---|---|---|---|');
for (const { row: r, f } of findings) console.log(`| ${STATE_LABEL[f.state]} | ${r.what} | ${r.value} | ${f.streak_days || ''} | ${r.action} |`);
for (const { f } of findings) if (f.state === 'degradado') console.log(`::warning::Degradación persistente: ${f.label} (${f.streak_days} días)`);
const n = (st: string) => findings.filter(({ f }) => f.state === st).length;
console.log(`\n${n('fallo')} fallo(s), ${n('degradado')} degradación(es), ${n('aislado')} aviso(s) aislado(s).${notes.length ? `\n\n${notes.join(' · ')}` : ''}`);
if (n('fallo')) process.exit(1);
