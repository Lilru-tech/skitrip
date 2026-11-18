// Afluencia histórica: solo observaciones verificables (docs/METEO-AFLUENCIA.md). Nada se estima, reparte ni rellena.
//
// - Cada observación es de UN ámbito (estación o dominio del catálogo), UNA fecha y UN tipo de medida. Los tipos de
//   medida no se mezclan: visitantes, esquiadores del día, días de esquí vendidos y pasos por remontes son cosas
//   distintas. Una cifra de grupo, de varios días o de temporada no se guarda (no se reparte).
// - Estado: 'value' (cifra; 0 es un cero confirmado) o 'closed' (cierre confirmado, sin cifra: un cierre no demuestra
//   cero visitantes). Si no hay observación, es «Sin dato»: no se guarda ninguna fila.
// - Comparación: solo el mismo día y mes de otros años. El 29 de febrero solo existe en años bisiestos y no se sustituye.
// - Muestras de récord o seleccionadas (noticias de récords) se muestran, pero su media no es «afluencia habitual».
// - Intensidad diaria = esquiadores del día / km abiertos ESE día en el MISMO ámbito, de un parte válido de esa fecha y
//   con km > 0. No es densidad simultánea ni tiempo de espera. Nunca km del catálogo, de otro día ni del legacy.
// - Porcentaje de capacidad: solo con un aforo documentado compatible; hoy no hay ninguno, así que no se calcula.

export type CrowdMeasure = 'visitors' | 'daily_skiers' | 'skier_days_sold' | 'lift_passages';
export const CROWD_MEASURES: readonly CrowdMeasure[] = ['daily_skiers', 'visitors', 'skier_days_sold', 'lift_passages'];
export const CROWD_MEASURE_LABEL: Record<CrowdMeasure, string> = {
  daily_skiers: 'Esquiadores del día', visitors: 'Visitantes', skier_days_sold: 'Días de esquí vendidos', lift_passages: 'Pasos por remontes',
};
/** Unidad de la cifra, en plural (la cifra es un recuento entero de esa unidad en un solo día). */
export const CROWD_UNIT: Record<CrowdMeasure, string> = {
  daily_skiers: 'esquiadores', visitors: 'visitantes', skier_days_sold: 'días de esquí', lift_passages: 'pasos por remontes',
};
export type CrowdStatus = 'value' | 'closed';
export type CrowdSample = 'regular' | 'record' | 'selected';
export const CROWD_SAMPLE_LABEL: Record<CrowdSample, string> = {
  regular: 'Observación', record: 'Muestra de récord', selected: 'Muestra seleccionada (no sistemática)',
};

export interface CrowdObservation {
  id: number; areaId: string; date: string; measure: CrowdMeasure; status: CrowdStatus; value: number | null;
  sample: CrowdSample; sourceRef: string; sourceTitle: string | null; sourcePublished: string | null; note: string | null;
}

/** Km del parte de un día: solo de un parte con fecha publicada igual a ese día, del mismo ámbito y con calidad ok. */
export interface SameDayKm { areaId: string; date: string; openKm: number | null; opStatus: string; quality: string; sourceDate: string | null; sourceId: string }

export type IntensityMissing = 'not_daily_skiers' | 'closed' | 'no_report' | 'no_km' | 'zero_km';
export const INTENSITY_MISSING_LABEL: Record<IntensityMissing, string> = {
  not_daily_skiers: 'la intensidad diaria solo se calcula con esquiadores del día',
  closed: 'cierre confirmado sin cifra',
  no_report: 'no hay un parte válido de ese mismo día y ámbito con km abiertos',
  no_km: 'el parte de ese día no publica km abiertos',
  zero_km: 'ese día había 0 km abiertos según el parte',
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** ¿Existe esa fecha en el calendario? (2026-02-29 no; 2024-02-29 sí). */
export function validDate(iso: string): boolean {
  const m = DATE_RE.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
/** ¿Existe ese día y mes en algún año? (02-29 sí, 02-30 y 04-31 no). */
export const validMmdd = (mmdd: string) => MMDD_RE.test(mmdd) && validDate(`2024-${mmdd}`);
export const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/**
 * Intensidad diaria de una observación, o el motivo por el que no se calcula. `km` son los partes del mismo ámbito y
 * fecha (si hay varios válidos que discrepan, no se elige uno: no se calcula).
 */
export function dailyIntensity(o: Pick<CrowdObservation, 'areaId' | 'date' | 'measure' | 'status' | 'value'>, km: readonly SameDayKm[]):
  { value: number; openKm: number; sourceId: string } | { value: null; missing: IntensityMissing; openKm: number | null } {
  if (o.status === 'closed') return { value: null, missing: 'closed', openKm: null };
  const valid = km.filter((k) => k.areaId === o.areaId && k.sourceDate === o.date && k.date === o.date && k.quality === 'ok' && k.opStatus !== 'unknown');
  const withKm = valid.filter((k) => k.openKm != null);
  const distinct = [...new Set(withKm.map((k) => k.openKm))];
  const openKm = distinct.length === 1 ? distinct[0]! : null;
  if (o.measure !== 'daily_skiers') return { value: null, missing: 'not_daily_skiers', openKm };
  if (!valid.length || distinct.length > 1) return { value: null, missing: 'no_report', openKm: null };
  if (openKm == null) return { value: null, missing: 'no_km', openKm: null };
  if (openKm <= 0) return { value: null, missing: 'zero_km', openKm };
  return { value: Math.round((o.value! / openKm) * 10) / 10, openKm, sourceId: withKm[0].sourceId };
}

export interface SameDaySummary {
  measure: CrowdMeasure;
  /** Años con una cifra (estado 'value') para ese día y mes. */
  yearsWithValue: number[];
  yearsClosed: number[];
  /** Años revisados sin ninguna observación de esta medida para ese día (dentro del intervalo consultado). */
  yearsWithout: number[];
  observations: number;
  /** Media solo entre cifras comparables (misma medida, mismo ámbito); null con menos de 2. */
  mean: number | null;
  min: number | null; max: number | null;
  /** Alguna cifra es de una muestra de récord o seleccionada: la media NO es afluencia habitual. */
  selectedSample: boolean;
}

/**
 * Años que se revisan para un día y mes: desde el primer año con cualquier observación guardada hasta el último año
 * en el que ese día ya ha pasado (hoy incluido). El 29/02 solo cuenta en años bisiestos (sin sustituir fechas).
 */
export function yearsChecked(mmdd: string, firstYear: number | null, today: string): number[] {
  if (firstYear == null) return [];
  const ty = +today.slice(0, 4);
  const lastYear = `${ty}-${mmdd}` <= today ? ty : ty - 1;
  const out: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) if (validDate(`${y}-${mmdd}`)) out.push(y);
  return out;
}

/** Observaciones del mismo día y mes (de un único ámbito), resumidas por tipo de medida. */
export function sameDaySummary(obs: readonly CrowdObservation[], areaId: string, mmdd: string, checked: readonly number[]): SameDaySummary[] {
  const mine = obs.filter((o) => o.areaId === areaId && o.date.slice(5) === mmdd);
  return CROWD_MEASURES.filter((m) => mine.some((o) => o.measure === m)).map((measure) => {
    const list = mine.filter((o) => o.measure === measure);
    const values = list.filter((o) => o.status === 'value');
    const nums = values.map((o) => o.value!);
    const yearsWithValue = [...new Set(values.map((o) => +o.date.slice(0, 4)))].sort();
    const yearsClosed = [...new Set(list.filter((o) => o.status === 'closed').map((o) => +o.date.slice(0, 4)))].sort();
    const seen = new Set([...yearsWithValue, ...yearsClosed]);
    return {
      measure, yearsWithValue, yearsClosed, yearsWithout: checked.filter((y) => !seen.has(y)), observations: list.length,
      mean: nums.length >= 2 ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null,
      min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null,
      selectedSample: values.some((o) => o.sample !== 'regular'),
    };
  });
}

export interface CrowdDraft {
  areaId: string; date: string; measure: CrowdMeasure; status: CrowdStatus; value: number | null; sample: CrowdSample;
  sourceRef: string; sourceTitle: string | null; sourcePublished: string | null; note: string | null; reason: string;
}

/** Validación de una observación que un administrador añade o corrige. Devuelve los errores (vacío = válida). */
export function validateCrowdDraft(d: CrowdDraft, today: string): string[] {
  const e: string[] = [];
  if (!validDate(d.date)) e.push('La fecha no existe en el calendario (el 29 de febrero solo en años bisiestos).');
  else if (d.date > today) e.push('La fecha no puede ser futura: solo se guardan observaciones ya ocurridas.');
  if (!CROWD_MEASURES.includes(d.measure)) e.push('Tipo de medida no válido.');
  if (d.status === 'value') {
    if (d.value == null || !Number.isInteger(d.value) || d.value < 0) e.push('Indica la cifra como número entero (0 solo si la fuente confirma cero).');
  } else if (d.status === 'closed') {
    if (d.value != null) e.push('Un cierre confirmado no lleva cifra: un cierre no demuestra cero visitantes.');
  } else e.push('Estado no válido.');
  if (!/^https:\/\/\S+$/.test(d.sourceRef.trim())) e.push('La fuente debe ser un enlace https verificable.');
  if (d.sourcePublished && !validDate(d.sourcePublished)) e.push('La fecha de publicación de la fuente no es válida.');
  if (d.sourcePublished && validDate(d.date) && d.sourcePublished < d.date) e.push('La fuente no puede ser anterior al día que describe.');
  if (d.sourcePublished && d.sourcePublished > today) e.push('La fecha de publicación no puede ser futura.');
  if (d.reason.trim().length < 5) e.push('Explica el motivo (mínimo 5 caracteres).');
  return e;
}
