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

/** Rutas de referencia (OSRM, desde los orígenes fijos) de al menos estos km: en tramos cortos la media no dice nada. */
const REF_MIN_KM = 50;
/** El tiempo del proveedor es dudoso si supera en más de este factor al que da la velocidad media de la referencia. */
const DOUBT_FACTOR = 1.4;
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

/**
 * Contraste del tiempo del proveedor con otra fuente: la ruta OSRM más rápida (min/km) guardada para la estación.
 * No corrige nada; solo marca el tiempo como dudoso para que la interfaz lo diga. Sin referencia o con pocos km, null.
 */
export function durationDoubt(roadKm: number | null, durationMin: number | null, refMinPerKm: number | null): { referenceMin: number } | null {
  if (roadKm == null || durationMin == null || refMinPerKm == null || !(refMinPerKm > 0) || roadKm < REF_MIN_KM) return null;
  const referenceMin = Math.round(roadKm * refMinPerKm);
  return durationMin > referenceMin * DOUBT_FACTOR ? { referenceMin } : null;
}

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
    SELECT a.id, COALESCE(x.lat, a.lat) AS lat, COALESCE(x.lon, a.lon) AS lon, x.name AS access_name, x.mode, x.note, x.confidence, x.source AS access_source, x.checked_on AS access_checked_on,
      (SELECT MIN(r.duration_min * 1.0 / r.road_km) FROM routes r WHERE r.area_id = a.id AND r.source LIKE 'OSRM%' AND r.duration_min > 0 AND r.road_km >= ${REF_MIN_KM}) AS ref_min_per_km
    FROM areas a LEFT JOIN area_access x ON x.area_id = a.id
    WHERE a.active = 1 AND a.id IN (SELECT DISTINCT area_id FROM routes) AND COALESCE(x.lat, a.lat) IS NOT NULL AND COALESCE(x.lon, a.lon) IS NOT NULL
    ORDER BY a.id LIMIT 60`).all<{ id: string; lat: number; lon: number; access_name: string | null; mode: string | null; note: string | null; confidence: string | null; access_source: string | null; access_checked_on: string | null; ref_min_per_km: number | null }>();
  if (!targets.length) return c.json({ routes: [], attribution: GEO_ATTRIBUTION, credits: 0 });
  await reserveCredits(c.env.DB, c.env, me, targets.length);
  const legs = await routeMatrix(c.env, from, targets);
  const checkedOn = new Date().toISOString().slice(0, 10);
  const byId = new Map(legs.map((l) => [l.id, l]));
  return c.json({
    attribution: GEO_ATTRIBUTION, credits: targets.length, checkedOn,
    routes: targets.map((t) => {
      const l = byId.get(t.id);
      const roadKm = l?.meters != null ? Math.max(1, Math.round(l.meters / 1000)) : null;
      const durationMin = l?.seconds != null ? Math.round(l.seconds / 60) : null;
      const doubt = durationDoubt(roadKm, durationMin, t.ref_min_per_km);
      // Sin acceso conocido se usa el punto central del catálogo y se dice que no es un acceso verificado.
      const access = t.access_name ?? '(punto central de la estación en el catálogo, no un acceso verificado)';
      const notes = [
        t.mode === 'rack_railway' ? t.note ?? 'Sin acceso en coche: el último tramo es en cremallera y no está incluido.' : t.note,
        !t.access_name ? 'Distancia hasta el punto central de la estación en el catálogo: el aparcamiento puede estar a varios km.'
          : t.confidence === 'single_source' ? 'Punto de llegada según una sola fuente pública, sin contrastar.'
          : t.confidence !== 'contrasted' ? 'Punto de llegada aproximado, sin confirmar.' : null,
        doubt ? `Tiempo dudoso: el proveedor da ${hm(durationMin!)} para ${roadKm} km, pero a la velocidad media de la ruta de referencia (OSRM) serían unas ${hm(doubt.referenceMin)}. La distancia no se pone en duda; el tiempo se muestra tal cual, sin corregir.` : null,
      ].filter(Boolean).join(' ') || null;
      return {
        areaId: t.id, accessName: access, lastLeg: t.mode === 'rack_railway' ? 'rack_railway' : null,
        access: t.access_name ? { confidence: t.confidence, source: t.access_source, checkedOn: t.access_checked_on } : { confidence: 'catalog_center', source: null, checkedOn: null },
        roadKm, durationMin, durationDoubtful: doubt != null,
        notes,
      };
    }),
  });
});
