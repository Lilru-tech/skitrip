// Textos en español para los datos heredados de la hoja y del histórico legacy. Los códigos (p. ej. «zero_ambiguous»)
// se guardan tal cual en D1 para no perder trazabilidad; la interfaz nunca los muestra sin explicar.

/** Ámbito de los comentarios generales (consejos del viaje) en la hoja antigua: no es una estación. */
export const GENERAL_SCOPE = 'global';
/** Formas aceptadas en un CSV para «consejo general», además de «global». */
const GENERAL_ALIASES = new Set(['global', 'general', 'consejo general', 'consejos generales', 'consejo', 'todas', 'todas las estaciones']);

/** Nombre normalizado para comparar (sin tildes, minúsculas, espacios y guiones unificados). */
export const normName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

export const isGeneralScope = (resortId: string | null | undefined) => !!resortId && GENERAL_ALIASES.has(normName(resortId));

const ANOMALY: Record<string, string> = {
  zero_ambiguous: 'Cero dudoso: el programa antiguo convertía «-» (sin dato) en 0; no significa que estuviera cerrada.',
  open_null: 'Sin km abiertos en la serie antigua.',
  total_mismatch_catalog: 'Los km totales de esta fila no coinciden con los del catálogo antiguo.',
  open_gt_total: 'Incoherente: más km abiertos que totales.',
  duplicate_of_astun_series: 'Copia exacta de la serie de Astún: es el dominio conjunto Astún-Candanchú.',
  scope_unknown: 'No se sabe a qué estación o dominio corresponde esta fila.',
  nights_missing: 'Sin número de noches.',
  no_hotel_identity: 'Sin hotel concreto.',
  no_stay_dates: 'Sin fechas de estancia.',
  no_occupancy: 'Sin ocupación (personas y habitaciones).',
  forfait_days_fixed_2: 'El programa antiguo fijaba 2 días de forfait aunque la oferta fuese de otro número.',
  cheapest_gt_avg: 'Incoherente: el más barato supera a la media.',
  non_positive_sample: 'Alguna muestra con precio 0 o negativo.',
};

/** Explicación de un aviso legacy. Los códigos desconocidos se devuelven tal cual (pueden ser ya texto). */
export function legacyAnomalyText(code: string): string {
  if (ANOMALY[code]) return ANOMALY[code];
  let m = /^scope_remapped_to_(.+)$/.exec(code);
  if (m) return `Asignada a «${m[1]}» por sus km totales (la serie antigua mezclaba ámbitos).`;
  m = /^top10_with_n_(\d+)$/.exec(code);
  if (m) return `La «media de las 10 más baratas» se calculó con solo ${m[1]} muestra${m[1] === '1' ? '' : 's'}.`;
  return code;
}

// ---------- Rutas por carretera ----------

export type RouteLevel = 'legacy' | 'computed' | 'reviewed';
export interface RouteInfo { source: string; checkedOn: string | null; validated: boolean; accessName: string; notes: string | null }

const numDate = (d: string) => { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; };
/** «OSRM (OpenStreetMap), router.project-osrm.org» → «OSRM (OpenStreetMap)». */
const shortSource = (s: string) => s.split(',')[0].trim();

/**
 * Tres niveles de procedencia, sin inflarlos:
 *  - legacy: distancia heredada del código antiguo, sin fuente ni fecha;
 *  - computed: calculada por un servicio de rutas con fuente y fecha, sin revisión humana (validated = 0);
 *  - reviewed: una persona la comprobó (validated = 1, solo por acción explícita).
 * El destino «(punto de la estación…)» es la coordenada aproximada del catálogo, no un acceso confirmado.
 */
export function routeProvenance(r: RouteInfo): { level: RouteLevel; label: string; detail: string; approxAccess: boolean } {
  const approxAccess = r.accessName.trim().startsWith('(');
  const access = approxAccess ? 'Destino: punto aproximado de la estación en el catálogo; el acceso o aparcamiento no está confirmado.' : `Destino: ${r.accessName}.`;
  if (r.validated) {
    return { level: 'reviewed', label: `revisada por una persona${r.checkedOn ? ` (${numDate(r.checkedOn)})` : ''}`, detail: `Fuente: ${shortSource(r.source)}. ${access}`, approxAccess };
  }
  if (r.source === 'legacy_hardcode' || r.source === 'legacy' || !r.checkedOn) {
    return { level: 'legacy', label: 'estimación heredada, sin fuente ni fecha', detail: `Distancia del SkiTrip antiguo, sin verificar. ${access}`, approxAccess };
  }
  if (r.source === 'manual') return { level: 'computed', label: `anotada a mano el ${numDate(r.checkedOn)}, sin revisar`, detail: access, approxAccess };
  return { level: 'computed', label: `calculada con ${shortSource(r.source)} el ${numDate(r.checkedOn)}, sin revisión humana`, detail: access, approxAccess };
}
