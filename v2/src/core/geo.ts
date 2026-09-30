// Distancias. Haversine es una estimación geográfica en línea recta: NUNCA se usa como km de
// carretera (combustible, filtro de 300 km). Sirve para validar rutas manuales.
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RouteCheckInput {
  originId: string;
  areaId: string;
  roadKm: number | null;
  origin: { lat: number; lon: number };
  area: { lat: number; lon: number } | null;
}
export interface RouteIssue { originId: string; areaId: string; issue: string }

/**
 * Validación de rutas por carretera introducidas a mano:
 *  - la carretera no puede ser más corta que la línea recta, ni más de 2,2 veces más larga;
 *  - dos áreas a < 12 km en línea recta no deberían diferir en > 60 km de carretera desde el mismo origen.
 * Una ruta con avisos se conserva, pero queda `validated = 0` y el aviso visible.
 */
export function validateRoutes(routes: RouteCheckInput[]): RouteIssue[] {
  const issues: RouteIssue[] = [];
  for (const r of routes) {
    if (r.roadKm == null || !r.area) continue;
    const straight = haversineKm(r.origin, r.area);
    if (r.roadKm < straight * 0.98) issues.push({ originId: r.originId, areaId: r.areaId, issue: `carretera (${r.roadKm} km) menor que la línea recta (${straight.toFixed(0)} km)` });
    else if (r.roadKm > straight * 2.2) issues.push({ originId: r.originId, areaId: r.areaId, issue: `carretera (${r.roadKm} km) > 2,2 × línea recta (${straight.toFixed(0)} km)` });
  }
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i], b = routes[j];
      if (a.originId !== b.originId || a.roadKm == null || b.roadKm == null || !a.area || !b.area) continue;
      if (haversineKm(a.area, b.area) < 12 && Math.abs(a.roadKm - b.roadKm) > 60) {
        const msg = `incoherente con ${b.areaId} (${b.roadKm} km), a menos de 12 km`;
        issues.push({ originId: a.originId, areaId: a.areaId, issue: msg });
        issues.push({ originId: b.originId, areaId: b.areaId, issue: `incoherente con ${a.areaId} (${a.roadKm} km), a menos de 12 km` });
      }
    }
  }
  return issues;
}
