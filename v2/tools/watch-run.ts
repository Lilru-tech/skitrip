// Aplica la política de vigilancia (watch-policy.ts) a las comprobaciones del día con el estado de D1 y los avisos de
// GitHub inyectados, para poder probar el flujo completo con fallos simulados (test/core/watch-run.test.ts) sin tocar
// D1 ni crear avisos reales. tools/watch.ts da las implementaciones reales.
//
// Mecanismos necesarios en GitHub Actions: leer watch_findings, guardarlo y gestionar los avisos. Si alguno falla, la
// ejecución sale con 1 y lo dice con ::error::, aunque todas las comprobaciones estén bien. Si no se puede leer el
// estado, no se calcula ni se guarda una racha nueva (empezar de cero cada día dejaría todo como «aislado» para
// siempre) ni se tocan los avisos. En local (fuera de Actions) no se lee ni se escribe estado ni se tocan avisos, y la
// salida lo dice: los niveles son solo los del día.
import { issueAction, issueMarker, nextState, type Finding, type Kind, type Level, type State } from './watch-policy';

export interface WatchRow { key: string; kind: Kind; level: Level; what: string; value: string; action: string }
export interface FindingStore {
  read(): Promise<Finding[]>;
  /** Inserta o actualiza las filas y borra las que llevan más de 14 días sin observarse. */
  write(findings: Finding[], day: string): Promise<void>;
}
export interface IssueTracker {
  listOpen(): Promise<{ number: number; body: string | null }[]>;
  ensureLabel(): Promise<void>;
  open(title: string, body: string): Promise<number>;
  close(number: number, comment: string): Promise<void>;
}
export type WatchMode = { kind: 'actions'; runUrl: string } | { kind: 'local' };

const STATE_LABEL: Record<State, string> = { ok: 'OK', aislado: 'aviso aislado', degradado: 'DEGRADADO', fallo: 'FALLO' };
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

export async function runWatch(rows: WatchRow[], day: string, mode: WatchMode, store: FindingStore | null, issues: IssueTracker | null): Promise<{ lines: string[]; exitCode: number; findings: Finding[] | null }> {
  const lines: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  let findings: { row: WatchRow; f: Finding }[] | null = null;

  if (mode.kind === 'local') {
    notes.push('MODO LOCAL: sin estado persistente (watch_findings) ni avisos de GitHub; los niveles son solo los de hoy.');
  } else {
    // 1) Estado anterior. Sin él no hay racha fiable: no se calcula, no se guarda y no se tocan avisos.
    let prev: Map<string, Finding> | null = null;
    if (!store) errors.push('falta el almacén de estado (watch_findings)');
    else {
      try { prev = new Map((await store.read()).map((f) => [f.key, f])); }
      catch (e) { errors.push(`no se pudo leer watch_findings: ${msg(e)}. Rachas y avisos sin actualizar; se conserva el estado anterior.`); }
    }
    if (prev) {
      try {
        findings = rows.map((row) => ({ row, f: nextState(prev!.get(row.key), { key: row.key, label: row.what, kind: row.kind, level: row.level, value: row.value }, day) }));
      } catch (e) { errors.push(`estado de watch_findings incoherente: ${msg(e)}`); }
    }
    // 2) Avisos de GitHub: el listado de abiertos (etiqueta «vigilancia» + marcador) evita duplicados.
    if (findings) {
      if (!issues) errors.push('sin GITHUB_TOKEN o GITHUB_REPOSITORY: avisos de GitHub no gestionados');
      else {
        let open: Map<string, number> | null = null;
        try {
          open = new Map();
          for (const i of await issues.listOpen()) { const m = /<!-- watch:(.+?) -->/.exec(i.body ?? ''); if (m) open.set(m[1], i.number); }
        } catch (e) { open = null; errors.push(`no se pudieron listar los avisos de GitHub: ${msg(e)}`); }
        if (open) {
          let labelled = false;
          for (const { row, f } of findings) {
            const openNo = open.get(f.key) ?? null;
            const act = issueAction(f, openNo);
            try {
              if (act === 'open') {
                if (!labelled) { await issues.ensureLabel(); labelled = true; }
                f.issue_number = await issues.open(`Vigilancia: ${f.label} ${f.state === 'fallo' ? 'falla' : 'degradada'}`,
                  `${issueMarker(f.key)}\n**${f.state === 'fallo' ? 'Fallo real' : `Degradación: ${f.streak_days} días seguidos`}** desde ${f.first_seen}.\n\n- Valor: ${row.value}\n- Qué hacer: ${row.action || '—'}\n- Ejecución: ${mode.runUrl}\n\nEste aviso se abre una vez y se cierra solo cuando la comprobación vuelve a OK (sin comentarios diarios).`);
                notes.push(`abierto aviso #${f.issue_number} (${f.key})`);
              } else if (act === 'close') {
                await issues.close(openNo!, `Recuperado el ${day}: ${row.value}. ${mode.runUrl}`);
                f.issue_number = null;
                notes.push(`cerrado aviso #${openNo} (${f.key})`);
              } else f.issue_number = openNo;
            } catch (e) {
              f.issue_number = openNo; // sin cambios: se reintenta mañana con el listado real
              errors.push(`aviso de GitHub de ${f.key} no ${act === 'open' ? 'abierto' : 'cerrado'}: ${msg(e)}`);
            }
          }
        }
      }
      // 3) Guardar el estado (aunque fallen los avisos: el número de aviso conserva el último conocido).
      try { await store!.write(findings.map(({ f }) => f), day); }
      catch (e) { errors.push(`no se pudo guardar watch_findings: ${msg(e)}. La racha de hoy no queda registrada.`); }
    }
  }

  lines.push('| Estado | Comprobación | Valor | Días | Qué hacer |', '|---|---|---|---|---|');
  if (findings) for (const { row, f } of findings) lines.push(`| ${STATE_LABEL[f.state]} | ${row.what} | ${row.value} | ${f.streak_days || ''} | ${row.action} |`);
  else for (const r of rows) lines.push(`| ${r.level}${mode.kind === 'local' ? '' : ' (sin racha)'} | ${r.what} | ${r.value} | | ${r.action} |`);
  if (findings) for (const { f } of findings) if (f.state === 'degradado') lines.push(`::warning::Degradación persistente: ${f.label} (${f.streak_days} días)`);
  for (const e of errors) lines.push(`::error::Vigilancia: ${e}`);
  const fails = findings ? findings.filter(({ f }) => f.state === 'fallo').length : rows.filter((r) => r.level === 'FALLO').length;
  const count = (st: State) => (findings ?? []).filter(({ f }) => f.state === st).length;
  lines.push('', findings
    ? `${fails} fallo(s), ${count('degradado')} degradación(es), ${count('aislado')} aviso(s) aislado(s); ${errors.length} error(es) de los mecanismos de vigilancia.`
    : `${fails} fallo(s), ${rows.filter((r) => r.level === 'AVISO').length} aviso(s) del día; ${errors.length} error(es) de los mecanismos de vigilancia.`);
  if (notes.length) lines.push('', notes.join(' · '));
  return { lines, exitCode: fails || errors.length ? 1 : 0, findings: findings?.map(({ f }) => f) ?? null };
}
