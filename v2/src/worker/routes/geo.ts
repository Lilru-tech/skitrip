import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { parseBody } from '../http';
import { rateLimit } from '../ratelimit';
import { GEO_ATTRIBUTION, geoCaps, geoEnabled, geoUsage, reserveCredits, routeMatrix, searchPlaces } from '../geo';

// Origen personalizado: buscar una dirección y calcular distancias por carretera hasta el acceso de cada estación.
// La dirección y las coordenadas llegan en el cuerpo (nunca en la URL), se reenvían a Geoapify y no se guardan.
export const geoRoutes = new Hono<AppEnv>();

// España peninsular, Baleares, Andorra y el sur de Francia: fuera de esto no tiene sentido ir en coche a estas estaciones.
const zLat = z.number().finite().min(35).max(51);
const zLon = z.number().finite().min(-10).max(10);

geoRoutes.get('/status', async (c) => {
  const caps = geoCaps(c.env);
  const used = await geoUsage(c.env.DB, c.get('user').id);
  return c.json({
    enabled: geoEnabled(c.env), attribution: GEO_ATTRIBUTION,
    user: { used: used.user, cap: caps.user }, global: { used: used.global, cap: caps.global },
  });
});

geoRoutes.post('/search', async (c) => {
  const me = c.get('user').id;
  const { text } = await parseBody(c, z.object({ text: z.string().trim().min(3).max(200) }));
  await rateLimit(c.env.DB, `geo:${me}`, 20, 60);
  await reserveCredits(c.env.DB, c.env, me, 1);
  return c.json({ results: await searchPlaces(c.env, text), attribution: GEO_ATTRIBUTION });
});

geoRoutes.post('/routes', async (c) => {
  const me = c.get('user').id;
  const from = await parseBody(c, z.object({ lat: zLat, lon: zLon }));
  await rateLimit(c.env.DB, `geo:${me}`, 20, 60);
  // Destinos: las estaciones que el catálogo compara por distancia (las que tienen ruta desde algún origen fijo).
  const { results: targets } = await c.env.DB.prepare(`
    SELECT a.id, COALESCE(x.lat, a.lat) AS lat, COALESCE(x.lon, a.lon) AS lon, x.name AS access_name, x.mode, x.note, x.confidence, x.source AS access_source, x.checked_on AS access_checked_on
    FROM areas a LEFT JOIN area_access x ON x.area_id = a.id
    WHERE a.active = 1 AND a.id IN (SELECT DISTINCT area_id FROM routes) AND COALESCE(x.lat, a.lat) IS NOT NULL AND COALESCE(x.lon, a.lon) IS NOT NULL
    ORDER BY a.id LIMIT 60`).all<{ id: string; lat: number; lon: number; access_name: string | null; mode: string | null; note: string | null; confidence: string | null; access_source: string | null; access_checked_on: string | null }>();
  if (!targets.length) return c.json({ routes: [], attribution: GEO_ATTRIBUTION, credits: 0 });
  await reserveCredits(c.env.DB, c.env, me, targets.length);
  const legs = await routeMatrix(c.env, from, targets);
  const checkedOn = new Date().toISOString().slice(0, 10);
  const byId = new Map(legs.map((l) => [l.id, l]));
  return c.json({
    attribution: GEO_ATTRIBUTION, credits: targets.length, checkedOn,
    routes: targets.map((t) => {
      const l = byId.get(t.id);
      // Sin acceso conocido se usa el punto central del catálogo y se dice que no es un acceso verificado.
      const access = t.access_name ?? '(punto central de la estación en el catálogo, no un acceso verificado)';
      const notes = [
        t.mode === 'rack_railway' ? t.note ?? 'Sin acceso en coche: el último tramo es en cremallera y no está incluido.' : t.note,
        !t.access_name ? 'Distancia hasta el punto central de la estación en el catálogo: el aparcamiento puede estar a varios km.'
          : t.confidence === 'single_source' ? 'Punto de llegada según una sola fuente pública, sin contrastar.'
          : t.confidence !== 'contrasted' ? 'Punto de llegada aproximado, sin confirmar.' : null,
      ].filter(Boolean).join(' ') || null;
      return {
        areaId: t.id, accessName: access, lastLeg: t.mode === 'rack_railway' ? 'rack_railway' : null,
        access: t.access_name ? { confidence: t.confidence, source: t.access_source, checkedOn: t.access_checked_on } : { confidence: 'catalog_center', source: null, checkedOn: null },
        roadKm: l?.meters != null ? Math.max(1, Math.round(l.meters / 1000)) : null,
        durationMin: l?.seconds != null ? Math.round(l.seconds / 60) : null,
        notes,
      };
    }),
  });
});
