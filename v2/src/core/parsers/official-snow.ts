// Adaptadores de webs oficiales de estaciones. Trabajan sobre el TEXTO de la página (HTML sin etiquetas), así que
// sirven igual para el HTML completo o un extracto de texto. Probados con un extracto real de texto; el HTML crudo no
// se ha podido capturar desde el entorno de desarrollo (sin salida a esas webs), por eso siguen «no verificada online».
import { parseHtml, textContent } from './html';
import type { OpStatus } from './snow';

export interface OfficialSnow {
  opStatus: OpStatus; openKm: number | null; totalKm: number | null; openRuns: number | null; totalRuns: number | null;
  openLifts: number | null; totalLifts: number | null; depthMinCm: number | null; depthMaxCm: number | null; sourceDate: string | null;
}

const toText = (input: string) => (/<[a-z][\s\S]*>/i.test(input) ? textContent(parseHtml(input)) : input).replace(/\s+/g, ' ');
const pair = (t: string, label: RegExp): [number, number] | null => {
  const m = new RegExp(`${label.source}\\s*(\\d{1,4})\\s*/\\s*(\\d{1,4})`, 'i').exec(t);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return b > 0 && a <= b ? [a, b] : null;
};

export function parseGrandvalira(input: string): OfficialSnow | null {
  const t = toText(input);
  const km = pair(t, /km esquiables/) ?? pair(t, /kil[oó]metros esquiables/);
  if (!km) return null;
  const runs = pair(t, /pistas(?!\s+(?:verde|azul|roja|negra))/);
  const lifts = pair(t, /instalaciones/);
  const depth = /espesores de nieve \(cm\)\s*(\d{1,4})\s*-\s*(\d{1,4})/i.exec(t);
  const d = /[úu]ltima actualizaci[oó]n:?\s*(?:[a-záéíóú]{2,4}\.?,?\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
  const [openKm, totalKm] = km;
  // Un 0 publicado puede ser fuera de temporada o cierre: sin texto explícito, el estado queda desconocido.
  const opStatus: OpStatus = openKm === 0 ? 'unknown' : openKm >= totalKm ? 'open' : 'partial';
  return {
    opStatus, openKm, totalKm, openRuns: runs?.[0] ?? null, totalRuns: runs?.[1] ?? null, openLifts: lifts?.[0] ?? null, totalLifts: lifts?.[1] ?? null,
    depthMinCm: depth ? Number(depth[1]) : null, depthMaxCm: depth ? Number(depth[2]) : null,
    sourceDate: d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null,
  };
}

/** Adaptadores oficiales por id de la columna `adapter` de sources. */
export const OFFICIAL_ADAPTERS: Record<string, { version: string; parse: (input: string) => OfficialSnow | null }> = {
  'grandvalira-official': { version: '1.0.0', parse: parseGrandvalira },
};
