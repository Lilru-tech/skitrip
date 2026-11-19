// Festivos y vacaciones: ingesta (credencial, validación, sustitución de la ventana) y API pública. Datos sintéticos; sin red.
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const TOKEN = 'test-ingest-token';
const per = (calendarId: string, kind: 'public' | 'school', start: string, end: string, name: string, scope: 'all' | 'part' = 'all') => ({ calendarId, kind, start, end, name, scope, parts: scope === 'part' ? 'AR-TE' : null });
const ingest = (body: unknown, token = TOKEN) => SELF.fetch('http://localhost/api/ingest/holidays', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async (path: string) => { const r = await SELF.fetch(`http://localhost${path}`); return { status: r.status, json: await r.json<any>() }; };
const base = [
  per('fr-zc', 'school', '2027-02-20', '2027-03-07', "Vacances d'hiver"),
  per('fr-zc', 'public', '2027-12-25', '2027-12-25', 'Noël'),
  per('es-ar', 'school', '2027-03-01', '2027-03-01', 'Día no lectivo', 'part'),
  per('es-ar', 'school', '2027-06-25', '2027-09-10', 'Vacaciones de verano'),
  per('es-ar', 'public', '2027-12-25', '2027-12-25', 'Navidad'),
  per('es-ct', 'public', '2027-12-26', '2027-12-26', 'San Esteban'),
];

beforeEach(async () => { await env.DB.prepare('DELETE FROM holiday_periods').run(); });

describe('ingesta de festivos', () => {
  it('pide la credencial y valida calendario, fechas y ventana', async () => {
    expect((await ingest({ from: '2026-11-01', to: '2028-10-01', periods: base }, 'otra-credencial-cualquiera')).status).toBe(401);
    expect((await ingest({ from: '2026-11-01', to: '2028-10-01', periods: [per('xx', 'public', '2027-01-01', '2027-01-01', 'X')] })).status).toBe(422);
    expect((await ingest({ from: '2026-11-01', to: '2028-10-01', periods: [per('es-ct', 'public', '2027-01-02', '2027-01-01', 'X')] })).status).toBe(422);
    expect((await ingest({ from: '2027-03-01', to: '2028-10-01', periods: base })).status).toBe(422);
    expect((await ingest({ from: '2026-11-01', to: '2028-10-01', periods: [] })).status).toBe(422);
  });
  it('reenviar sustituye los periodos que empiezan en la ventana y respeta los de fuera', async () => {
    expect(await (await ingest({ from: '2026-11-01', to: '2028-10-01', periods: base })).json()).toEqual({ deleted: 0, written: 6, received: 6 });
    await env.DB.prepare(`INSERT INTO holiday_periods (calendar_id, kind, start_date, end_date, name, scope, fetched_at) VALUES ('es-ct', 'school', '2026-06-20', '2026-09-07', 'Viejo', 'all', 1)`).run();
    const r = await (await ingest({ from: '2026-11-01', to: '2028-10-01', periods: base.slice(0, 2) })).json<any>();
    expect(r).toEqual({ deleted: 6, written: 2, received: 2 });
    const { results } = await env.DB.prepare('SELECT name FROM holiday_periods ORDER BY start_date').all<{ name: string }>();
    expect(results.map((x) => x.name)).toEqual(['Viejo', "Vacances d'hiver", 'Noël']);
  });
});

describe('API pública', () => {
  it('periodos de las fechas por calendario; sin calendario publicado se dice; fin de semana lo calcula la web', async () => {
    await ingest({ from: '2026-11-01', to: '2028-10-01', periods: base });
    const { status, json } = await get('/api/public/holidays?desde=2027-02-27&hasta=2027-03-01');
    expect(status).toBe(200);
    expect(json.days).toEqual(['2027-02-27', '2027-02-28', '2027-03-01']);
    expect(json.calendars).toHaveLength(10);
    const by = new Map(json.calendars.map((c: any) => [c.calendarId, c]));
    expect((by.get('fr-zc') as any).periods).toMatchObject([{ name: "Vacances d'hiver", from: '2027-02-27', to: '2027-03-01' }]);
    expect((by.get('fr-zc') as any).unknownDays).toEqual([]);
    // Aragón: solo un día no lectivo en parte; su calendario escolar llega a septiembre, así que los días son conocidos.
    expect((by.get('es-ar') as any).periods).toMatchObject([{ name: 'Día no lectivo', scope: 'part' }]);
    expect((by.get('es-ar') as any).unknownDays).toEqual([]);
    // Cataluña: hay festivos pero no vacaciones escolares guardadas → sin calendario, nunca «sin fiesta».
    expect((by.get('es-ct') as any).unknownDays).toHaveLength(3);
    expect((by.get('ad') as any).knownUntil).toEqual({ public: null, school: null });
    expect(json.fetchedAt).toEqual(expect.any(Number));
    expect(json.source).toMatch(/OpenHolidays/);
  });
  it('valida las fechas (como mucho 31 días) y sin datos lo dice', async () => {
    expect((await get('/api/public/holidays?desde=2027-02-27&hasta=2027-02-26')).status).toBe(422);
    expect((await get('/api/public/holidays?desde=2027-01-01&hasta=2027-02-01')).status).toBe(422);
    expect((await get('/api/public/holidays?desde=2027-02-30')).status).toBe(422);
    const { json } = await get('/api/public/holidays?desde=2027-01-01&hasta=2027-01-01');
    expect(json.fetchedAt).toBeNull();
    expect(json.calendars.every((c: any) => c.unknownDays.length === 1)).toBe(true);
  });
});
