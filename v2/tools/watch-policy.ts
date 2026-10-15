// Política de la vigilancia diaria, pura y probada (test/core/watch-policy.test.ts). Tres niveles:
//  · aislado: un AVISO que aparece un día. Se muestra, no avisa.
//  · degradado: el mismo AVISO en días distintos seguidos (2 para una fuente que funcionaba y dejó de hacerlo, 3 para
//    el resto). Se abre UN aviso (issue) en GitHub con la etiqueta «vigilancia»; no se comenta a diario.
//  · fallo: un FALLO real (API caída, cortes por CPU, captura sin éxito fuera de plazo…). El workflow queda en rojo y
//    también abre el aviso.
// Al volver a OK el aviso se cierra con un único comentario. Una ausencia legítima (fuera de temporada, sin parte
// publicado) es OK y queda pendiente de invierno, no degradación.
import { LEGITIMATE_ABSENCE } from '../src/core/snow-outcome';

export type Level = 'OK' | 'AVISO' | 'FALLO';
export type State = 'ok' | 'aislado' | 'degradado' | 'fallo';
export type Kind = 'check' | 'regression' | 'pending' | 'absence';
export interface Finding { key: string; label: string; kind: Kind; state: State; streak_days: number; first_seen: string | null; last_day: string; last_value: string | null; issue_number: number | null }

export const DEGRADE_AFTER: Record<Kind, number> = { regression: 2, pending: 3, check: 3, absence: 3 };

/** Siguiente estado de una comprobación. Varias ejecuciones el mismo día cuentan como un solo día. */
export function nextState(prev: Finding | undefined, obs: { key: string; label: string; kind: Kind; level: Level; value: string }, day: string): Finding {
  const base = { key: obs.key, label: obs.label, kind: obs.kind, last_day: day, last_value: obs.value, issue_number: prev?.issue_number ?? null };
  if (obs.level === 'OK') return { ...base, state: 'ok', streak_days: 0, first_seen: null };
  const sameDay = prev && prev.state !== 'ok' && prev.last_day === day;
  const streak = prev && prev.state !== 'ok' ? prev.streak_days + (sameDay ? 0 : 1) : 1;
  const first = prev && prev.state !== 'ok' ? prev.first_seen ?? day : day;
  const state: State = obs.level === 'FALLO' ? 'fallo' : streak >= DEGRADE_AFTER[obs.kind] ? 'degradado' : 'aislado';
  return { ...base, state, streak_days: streak, first_seen: first };
}

/** Qué hacer con el aviso de GitHub: abrir solo si no hay uno abierto; cerrar al recuperarse; nada en otro caso. */
export function issueAction(f: Finding, openIssue: number | null): 'open' | 'close' | null {
  if ((f.state === 'degradado' || f.state === 'fallo') && !openIssue) return 'open';
  if (f.state === 'ok' && openIssue) return 'close';
  return null;
}
export const issueMarker = (key: string) => `<!-- watch:${key} -->`;

export interface SourceRow { id: string; area_id: string; status: string; last_attempt_at: number | null; last_success_at: number | null; last_status: string | null; reason: string | null; consecutive_fail: number | null }

/**
 * Edad y cobertura de una fuente prioritaria. Distingue una fuente que funcionaba y dejó de hacerlo (regresión, como
 * La Molina el 12/10) de una que nunca ha dado datos (pendiente) y de una ausencia legítima (fuera de temporada).
 */
export function classifySource(s: SourceRow, nowMs: number, maxAgeMs: number): { kind: Kind; level: Level; value: string; action: string } {
  const age = (t: number) => `${((nowMs - t) / 864e5).toFixed(1)} días`;
  if (!s.last_attempt_at) return { kind: 'pending', level: 'AVISO', value: 'sin ningún intento', action: 'Comprobar que la fuente está en la captura.' };
  if (nowMs - s.last_attempt_at > maxAgeMs) return { kind: s.last_success_at ? 'regression' : 'pending', level: 'AVISO', value: `último intento hace ${age(s.last_attempt_at)}`, action: 'La captura programada no la ha intentado: revisar el workflow.' };
  // Sin adaptador o robots.txt lo impide: limitación documentada en docs/SOURCES.md, no una degradación diaria.
  if (s.last_status === 'unsupported') return { kind: 'absence', level: 'OK', value: 'no soportada por la fuente (documentado)', action: '' };
  if (s.last_status === 'ok') return { kind: 'regression', level: 'OK', value: `datos hace ${age(s.last_success_at ?? s.last_attempt_at)}`, action: '' };
  if (s.last_status === 'empty' && s.reason && (LEGITIMATE_ABSENCE as readonly string[]).includes(s.reason))
    return { kind: 'absence', level: 'OK', value: `${s.reason === 'off_season' ? 'fuera de temporada' : 'sin parte publicado'} (pendiente de invierno)`, action: '' };
  const why = `${s.last_status}${s.reason ? `/${s.reason}` : ''} ×${s.consecutive_fail ?? 0}`;
  return s.last_success_at
    ? { kind: 'regression', level: 'AVISO', value: `dejó de funcionar: ${why}; último dato hace ${age(s.last_success_at)}`, action: 'Funcionaba y ha dejado de hacerlo: lanzar «v2 · comprobar fuentes online» y revisar el formato.' }
    : { kind: 'pending', level: 'AVISO', value: `nunca ha dado datos: ${why}`, action: 'Pendiente: revisar el adaptador o documentar por qué no se puede leer.' };
}
