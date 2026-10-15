// robots.txt según RFC 9309: grupos por user-agent (el específico de SkiTripBot sustituye a «*»), reglas Allow y
// Disallow con «*» y «$», y gana la regla más larga que coincide (Allow si empatan). Lo usan los recolectores para la
// página y para cada petición que la página haga al renderizarse (una XHR a una ruta prohibida también lo está).
export interface RobotsRule { allow: boolean; pattern: string; re: RegExp }

const toRegExp = (p: string) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$')}`);

export function parseRobots(text: string, agent = 'skitripbot'): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === 'allow', pattern: val, re: toRegExp(val) });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

/** `path` incluye la query (p. ej. «/listado_hoteles?zona=1»). */
export function robotsAllows(rules: readonly RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/**
 * Qué significa una respuesta al pedir robots.txt (RFC 9309 §2.3.1): 2xx → sus reglas; 4xx → sin restricciones;
 * 5xx o error de red → «no disponible». No disponible no es «prohibido»: no se carga la página (se trata como
 * prohibido por prudencia), pero la fuente queda como fallo de transporte, no como «no soportada» por la fuente.
 */
export type RobotsState = { kind: 'rules'; rules: RobotsRule[] } | { kind: 'unavailable'; detail: string };
export function robotsFromResponse(status: number | null, text: string, error?: string): RobotsState {
  if (status === null) return { kind: 'unavailable', detail: `robots.txt no disponible (${error ?? 'error de red'})` };
  if (status >= 200 && status < 300) return { kind: 'rules', rules: parseRobots(text) };
  if (status >= 400 && status < 500) return { kind: 'rules', rules: [] };
  return { kind: 'unavailable', detail: `robots.txt no disponible (HTTP ${status})` };
}
export type RobotsVerdict = { verdict: 'allowed' } | { verdict: 'denied' } | { verdict: 'unavailable'; detail: string };
export function robotsVerdict(state: RobotsState, path: string): RobotsVerdict {
  if (state.kind === 'unavailable') return { verdict: 'unavailable', detail: state.detail };
  return robotsAllows(state.rules, path) ? { verdict: 'allowed' } : { verdict: 'denied' };
}
