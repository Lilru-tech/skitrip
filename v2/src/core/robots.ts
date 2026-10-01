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
