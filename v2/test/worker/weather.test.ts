// Previsión en la API con Open-Meteo simulado (sin red): caché compartida, una descarga por punto, tope diario,
// errores del proveedor, horizonte, dominio frente a estación, resumen de Comparar solo desde caché y cron.
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../../data/catalog.json';
import worker from '../../src/worker/index';
import { todayMadrid } from '../../src/core/dates';
import { addDaysIso } from '../../src/core/weather';
import { seedCatalog } from './helpers';

const realFetch = globalThis.fetch;
type Mock = { forecastCalls: URL[]; metaCalls: number; fail?: number; delayMs?: number };
let mock: Mock;
const HORIZON: Record<string, number> = { ecmwf_ifs: 192, icon_seamless: 180, meteofrance_seamless: 96 };

function install(m: Partial<Mock> = {}) {
  mock = { forecastCalls: [], metaCalls: 0, ...m };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname !== 'meteo.mock') return realFetch(input, init);
    if (url.pathname.endsWith('/meta.json')) { mock.metaCalls++; return Response.json({ last_run_initialisation_time: Math.floor(Date.now() / 1000 / 21600) * 21600 }); }
    mock.forecastCalls.push(url);
    if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs));
    if (mock.fail) return new Response('fail', { status: mock.fail });
    const lats = url.searchParams.get('latitude')!.split(',');
    const t0 = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) / 1000;
    const time = Array.from({ length: 192 }, (_, i) => t0 + i * 3600);
    const loc = (i: number) => {
      const hourly: Record<string, unknown> = { time };
      for (const [m, n] of Object.entries(HORIZON)) {
        const v = (x: number) => time.map((_, h) => (h < n ? x : null));
        Object.assign(hourly, { [`temperature_2m_${m}`]: v(-3), [`precipitation_${m}`]: v(m === 'icon_seamless' ? 0.5 : 0), [`rain_${m}`]: v(0), [`snowfall_${m}`]: v(m === 'icon_seamless' ? 0.4 : 0),
          [`wind_speed_10m_${m}`]: v(20), [`wind_gusts_10m_${m}`]: v(m === 'ecmwf_ifs' ? 70 : 40) });
      }
      return { latitude: Number(lats[i]), longitude: 1, elevation: Number(url.searchParams.get('elevation')!.split(',')[i]), hourly };
    };
    return Response.json(lats.length === 1 ? loc(0) : lats.map((_, i) => loc(i)));
  });
}
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
  await env.DB.batch((catalog as any).links.map((l: any) => env.DB.prepare('INSERT OR IGNORE INTO area_links (parent_id, child_id, relation) VALUES (?1, ?2, ?3)').bind(l.parent, l.child, l.relation)));
});
beforeEach(async () => { await env.DB.batch([env.DB.prepare('DELETE FROM weather_forecasts'), env.DB.prepare('DELETE FROM weather_usage')]); });

const today = () => todayMadrid();
const get = async (path: string) => { const r = await SELF.fetch(`http://localhost${path}`); return { status: r.status, json: await r.json<any>() }; };

describe('ficha', () => {
  it('descarga una vez, guarda la agregación y reutiliza la caché; la altitud pedida es la del punto en pistas', async () => {
    install();
    const t = today();
    const a = await get(`/api/public/areas/la-molina/forecast?desde=${t}&hasta=${addDaysIso(t, 2)}`);
    expect(a.status).toBe(200);
    expect(mock.forecastCalls).toHaveLength(1);
    const q = mock.forecastCalls[0].searchParams;
    expect(q.get('elevation')).toBe('2077');
    expect(q.get('models')).toBe('ecmwf_ifs,icon_seamless,meteofrance_seamless');
    expect(q.get('timezone')).toBe('GMT');
    const p = a.json.points[0];
    expect(p).toMatchObject({ areaId: 'la-molina', freshness: 'fresh', point: { elevation: 2077, baseM: 1616, topM: 2537 }, cell: { elevation: 2077 } });
    expect(p.models.map((m: any) => m.id)).toEqual(['ecmwf_ifs', 'icon_seamless', 'meteofrance_seamless']);
    expect(p.models[0].runAt).toBeGreaterThan(0);
    // Hoy no tiene sus 24 horas locales (la serie empieza a las 00:00 UTC = 01:00 local) salvo que cuadre: los días 1 y 2 sí.
    const d1 = p.days[1];
    expect(d1.horizon).toBe('near');
    expect(d1.models.map((m: any) => m.id)).toEqual(['ecmwf_ifs', 'icon_seamless', 'meteofrance_seamless']);
    expect(d1.range.gustMax).toEqual([40, 70]);
    expect(d1.range.snow[1]).toBeCloseTo(9.6);
    expect(a.json.attribution).toMatch(/Open-Meteo.*CC BY 4\.0/);
    await get(`/api/public/areas/la-molina/forecast?desde=${t}&hasta=${addDaysIso(t, 2)}`);
    expect(mock.forecastCalls).toHaveLength(1);
  });

  it('fechas fuera del horizonte: «Todavía no hay previsión disponible» y ninguna descarga', async () => {
    install();
    const t = today();
    const r = await get(`/api/public/areas/cerler/forecast?desde=${addDaysIso(t, 20)}&hasta=${addDaysIso(t, 22)}`);
    expect(mock.forecastCalls).toHaveLength(0);
    expect(r.json.points[0].days.every((d: any) => d.horizon === 'beyond' && d.models.length === 0)).toBe(true);
    expect(r.json.points[0].summary.state).toBe('none');
  });

  it('viaje en parte cubierto: días con modelos, días sin previsión y tendencia con menos modelos', async () => {
    install();
    const t = today();
    const r = await get(`/api/public/areas/cerler/forecast?desde=${addDaysIso(t, 5)}&hasta=${addDaysIso(t, 9)}`);
    const days = r.json.points[0].days;
    expect(days.map((d: any) => d.horizon)).toEqual(['trend', 'trend', 'trend', 'beyond', 'beyond']);
    expect(days[0].models.map((m: any) => m.id)).toEqual(['ecmwf_ifs', 'icon_seamless']);
    expect(r.json.points[0].summary).toMatchObject({ state: 'partial', coveredDays: 3, days: 5 });
  });

  it('dominio: una previsión por estación, sin mezclar puntos', async () => {
    install();
    const r = await get(`/api/public/areas/formigal-panticosa/forecast?desde=${today()}`);
    expect(r.json.points.map((p: any) => [p.areaId, p.point.elevation])).toEqual([['formigal', 1883], ['panticosa', 1675]]);
    expect(mock.forecastCalls).toHaveLength(1);
    expect(mock.forecastCalls[0].searchParams.get('elevation')).toBe('1883,1675');
  });

  it('fallo del proveedor: aviso y la última previsión guardada con su antigüedad; nunca «buen tiempo»', async () => {
    install();
    await get(`/api/public/areas/astun/forecast?desde=${today()}`);
    await env.DB.prepare('UPDATE weather_forecasts SET fetched_at = fetched_at - 13 * 3600000').run();
    install({ fail: 500 });
    const r = await get(`/api/public/areas/astun/forecast?desde=${today()}`);
    expect(r.json.notice).toMatch(/no ha respondido/);
    expect(r.json.points[0].freshness).toBe('stale');
    install({ fail: 500 });
    await env.DB.prepare('DELETE FROM weather_forecasts').run();
    const none = await get(`/api/public/areas/astun/forecast?desde=${today()}`);
    expect(none.json.points[0]).toMatchObject({ freshness: null, summary: { state: 'none' } });
    expect(await env.DB.prepare('SELECT refreshing_until FROM weather_forecasts WHERE area_id = ?1').bind('astun').first('refreshing_until')).toBeNull();
  });

  it('tope diario propio: al agotarlo no llama al proveedor e informa', async () => {
    install();
    await env.DB.prepare(`INSERT INTO weather_usage (day, units, requests) VALUES (?1, 39.5, 1)`).bind(new Date().toISOString().slice(0, 10)).run();
    const r = await get(`/api/public/areas/candanchu/forecast?desde=${today()}`);
    expect(mock.forecastCalls).toHaveLength(0);
    expect(r.json.notice).toMatch(/tope diario/);
  });

  it('dos consultas simultáneas del mismo punto: una sola descarga y las dos reciben la previsión', async () => {
    install({ delayMs: 50 });
    const t = today();
    const both = await Promise.all([get(`/api/public/areas/javalambre/forecast?desde=${t}`), get(`/api/public/areas/javalambre/forecast?desde=${t}`)]);
    expect(mock.forecastCalls).toHaveLength(1);
    // La que no descarga espera a la otra: las dos devuelven la previsión, ninguna «sin previsión».
    expect(both.map((r) => r.json.points[0].freshness)).toEqual(['fresh', 'fresh']);
  });

  it('fechas no válidas', async () => {
    expect((await get('/api/public/areas/cerler/forecast?desde=2027-02-10&hasta=2027-02-01')).status).toBe(422);
    expect((await get('/api/public/areas/cerler/forecast?desde=2027-01-01&hasta=2027-03-01')).status).toBe(422);
    expect((await get('/api/public/areas/cerler/forecast?desde=mañana')).status).toBe(422);
  });
});

describe('Comparar y cron', () => {
  it('Comparar solo lee la caché (sin llamar al proveedor) y marca lo consultado; el cron lo descarga después', async () => {
    install();
    const t = today();
    const r = await get(`/api/public/forecast?areas=cerler,masella,no-existe&desde=${t}&hasta=${addDaysIso(t, 1)}`);
    expect(mock.forecastCalls).toHaveLength(0);
    expect(r.json.areas.map((a: any) => [a.areaId, a.summary.state])).toEqual([['cerler', 'none'], ['masella', 'none']]);
    await worker.scheduled!({ scheduledTime: Date.parse(`${t}T10:17:00Z`), cron: '*/20 * * * *' } as any, env as any);
    expect(mock.forecastCalls).toHaveLength(1);
    expect(mock.forecastCalls[0].searchParams.get('latitude')!.split(',')).toHaveLength(2);
    const again = await get(`/api/public/forecast?areas=cerler,masella&desde=${addDaysIso(t, 1)}&hasta=${addDaysIso(t, 2)}`);
    expect(again.json.areas.map((a: any) => a.summary.state)).toEqual(['complete', 'complete']);
    // Franja de esquí por día y modelo para el criterio meteorológico (solo previsión próxima).
    expect(again.json.areas[0].ski.map((d: any) => d.date)).toEqual([addDaysIso(t, 1), addDaysIso(t, 2)]);
    expect(again.json.areas[0].ski[0].models.find((m: any) => m.id === 'ecmwf_ifs')).toEqual({ id: 'ecmwf_ifs', rain: 0, strong: 8, hours: 8 });
    // Sin consultas recientes, el cron no gasta.
    await env.DB.prepare('UPDATE weather_forecasts SET last_requested_at = 0, fetched_at = 0').run();
    await worker.scheduled!({ scheduledTime: Date.now(), cron: '*/20 * * * *' } as any, env as any);
    expect(mock.forecastCalls).toHaveLength(1);
  });
});
