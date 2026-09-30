// Formulario de viaje (crear/editar). Los valores se mantienen si la red falla.
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../components/Field';
import { parseAges, TRIP_STATUS_LABEL } from '../format';
import { daysBetween, isValidDate } from '../../core/dates';
import type { Trip, TripStatus } from '../types';
import { get } from '../api';
import { useResource } from '../hooks';
import type { Catalog } from '../catalog';

export interface TripFormValues {
  name: string; startDate: string; endDate: string; nights: string; participantsPlanned: string; budgetEuros: string;
  status: TripStatus; membersCanInvite: boolean; cars: string; skiDays: string; areaId: string; childrenAges: string; rooms: string;
}

export const emptyTripForm = (): TripFormValues => ({ name: '', startDate: '', endDate: '', nights: '', participantsPlanned: '', budgetEuros: '', status: 'planning', membersCanInvite: false, cars: '', skiDays: '', areaId: '', childrenAges: '', rooms: '' });

export const tripToForm = (t: Trip): TripFormValues => ({
  name: t.name, startDate: t.startDate ?? '', endDate: t.endDate ?? '', nights: t.nights?.toString() ?? '',
  participantsPlanned: t.participantsPlanned?.toString() ?? '',
  budgetEuros: t.budgetCents != null ? (t.budgetCents / 100).toString().replace('.', ',') : '',
  status: t.status, membersCanInvite: t.membersCanInvite, cars: t.cars?.toString() ?? '', skiDays: t.skiDays?.toString() ?? '', areaId: t.areaId ?? '',
  childrenAges: (t.childrenAges ?? []).join(', '), rooms: t.rooms?.toString() ?? '',
});

const int = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));
const cents = (s: string) => {
  const t = s.trim().replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export function formToPayload(v: TripFormValues, includeOwnerFields: boolean) {
  const p: Record<string, unknown> = {
    name: v.name.trim(), startDate: v.startDate || null, endDate: v.endDate || null, nights: int(v.nights),
    participantsPlanned: int(v.participantsPlanned), budgetCents: cents(v.budgetEuros), status: v.status,
    cars: int(v.cars), skiDays: int(v.skiDays), areaId: v.areaId || null,
    childrenAges: parseAges(v.childrenAges) ?? [], rooms: int(v.rooms),
  };
  if (includeOwnerFields) p.membersCanInvite = v.membersCanInvite;
  return p;
}

export function validateTripForm(v: TripFormValues): string | null {
  if (!v.name.trim()) return 'El viaje necesita un nombre.';
  if (v.startDate && v.endDate && v.endDate < v.startDate) return 'La fecha de vuelta no puede ser anterior a la de ida.';
  const b = cents(v.budgetEuros);
  if (b !== null && (Number.isNaN(b) || b < 0)) return 'El presupuesto debe ser un importe en euros (por ejemplo, 350 o 350,50).';
  const n = int(v.nights);
  if (n !== null && (Number.isNaN(n) || n < 0 || n > 60)) return 'Las noches deben ser un número entre 0 y 60.';
  const pp = int(v.participantsPlanned);
  if (pp !== null && (Number.isNaN(pp) || pp < 1 || pp > 60)) return 'Las personas previstas deben ser entre 1 y 60.';
  const cs = int(v.cars);
  if (cs !== null && (Number.isNaN(cs) || cs < 0 || cs > 20)) return 'Los coches deben ser entre 0 y 20.';
  const sd = int(v.skiDays);
  if (sd !== null && (Number.isNaN(sd) || sd < 0 || sd > 60)) return 'Los días de esquí deben ser entre 0 y 60.';
  const ages = parseAges(v.childrenAges);
  if (!ages) return 'Edades de menores: números de 0 a 17 separados por comas (por ejemplo, 8, 12).';
  if (pp !== null && ages.length >= pp) return 'Los menores se cuentan dentro de las personas previstas y debe haber al menos un adulto.';
  const rm = int(v.rooms);
  if (rm !== null && (Number.isNaN(rm) || rm < 1 || rm > 30)) return 'Las habitaciones deben ser entre 1 y 30.';
  return null;
}

/** Diferencias entre lo que el usuario había escrito y la versión recargada (para no perder nada en silencio). */
export function diffForms(mine: TripFormValues, latest: TripFormValues): string[] {
  const labels: Record<keyof TripFormValues, string> = {
    name: 'Nombre', startDate: 'Ida', endDate: 'Vuelta', nights: 'Noches', participantsPlanned: 'Personas previstas', budgetEuros: 'Presupuesto (€)',
    status: 'Estado', membersCanInvite: 'Miembros pueden invitar', cars: 'Coches', skiDays: 'Días de esquí', areaId: 'Estación',
    childrenAges: 'Edades de menores', rooms: 'Habitaciones',
  };
  return (Object.keys(labels) as (keyof TripFormValues)[])
    .filter((k) => mine[k] !== latest[k])
    .map((k) => `${labels[k]}: ${typeof mine[k] === 'boolean' ? (mine[k] ? 'sí' : 'no') : mine[k] || '(vacío)'}`);
}

interface Props {
  id: string;
  values: TripFormValues;
  onChange: (v: TripFormValues) => void;
  onSubmit: () => void;
  showStatus?: boolean;
  showOwnerFields?: boolean;
  /** Error del servidor sobre las noches (422 nights_mismatch), mostrado junto al campo. */
  nightsError?: string | null;
}

/** Noches que salen de las fechas (null si falta alguna o no cuadran). */
export const derivedNights = (start: string, end: string) =>
  start && end && isValidDate(start) && isValidDate(end) && end >= start ? daysBetween(start, end) : null;

export function TripForm({ id, values: v, onChange, onSubmit, showStatus, showOwnerFields, nightsError }: Props) {
  const [touched, setTouched] = useState(false);
  const areas = useResource(() => get<Catalog>('/api/public/catalog'), []);
  const set = <K extends keyof TripFormValues>(k: K, val: TripFormValues[K]) => onChange({ ...v, [k]: val });
  // Con ida y vuelta, las noches salen de las fechas: se actualizan al cambiarlas (se pueden corregir a mano; el servidor avisa si no cuadran).
  const setDate = (k: 'startDate' | 'endDate', val: string) => {
    const next = { ...v, [k]: val };
    const d = derivedNights(next.startDate, next.endDate);
    onChange(d != null ? { ...next, nights: String(d) } : next);
  };
  const derived = derivedNights(v.startDate, v.endDate);
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); onSubmit(); };
  return (
    <form id={id} className="form-grid" onSubmit={submit} noValidate>
      <Field className="span-2" label="Nombre del viaje" required maxLength={120} value={v.name} onChange={(e) => set('name', e.target.value)}
        error={touched && !v.name.trim() ? 'Obligatorio.' : null} placeholder="Por ejemplo: Puente de diciembre" />
      <Field label="Ida" type="date" value={v.startDate} onChange={(e) => setDate('startDate', e.target.value)} hint="Opcional" />
      <Field label="Vuelta" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => setDate('endDate', e.target.value)} hint="Opcional" />
      <Field label="Noches" type="number" inputMode="numeric" min={0} max={60} value={v.nights} onChange={(e) => set('nights', e.target.value)}
        hint={derived != null ? `Salen de las fechas: ${derived}` : 'Para buscar ventanas en el calendario'} error={nightsError} />
      <Field label="Personas previstas" type="number" inputMode="numeric" min={1} max={60} value={v.participantsPlanned} onChange={(e) => set('participantsPlanned', e.target.value)} hint="Incluye a los menores" />
      <Field label="Edades de menores" inputMode="numeric" value={v.childrenAges} onChange={(e) => set('childrenAges', e.target.value)} hint="Separadas por comas, p. ej. 8, 12. Vacío = sin menores" />
      <Field label="Habitaciones" type="number" inputMode="numeric" min={1} max={30} value={v.rooms} onChange={(e) => set('rooms', e.target.value)} hint="Opcional; para comparar cotizaciones" />
      <Field label="Presupuesto por persona (€)" inputMode="decimal" value={v.budgetEuros} onChange={(e) => set('budgetEuros', e.target.value)} hint="Opcional, en euros" />
      <Field label="Días de esquí" type="number" inputMode="numeric" min={0} max={60} value={v.skiDays} onChange={(e) => set('skiDays', e.target.value)} hint="Para forfait y alquiler" />
      <Field label="Coches" type="number" inputMode="numeric" min={0} max={20} value={v.cars} onChange={(e) => set('cars', e.target.value)} hint="Para combustible, peajes y parking" />
      <SelectField label="Estación" value={v.areaId} onChange={(e) => set('areaId', e.target.value)} hint="Para la distancia por carretera del presupuesto">
        <option value="">Sin decidir</option>
        {(areas.data?.areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        {v.areaId && !areas.data?.areas.some((a) => a.id === v.areaId) && <option value={v.areaId}>{v.areaId}</option>}
      </SelectField>
      {showStatus && (
        <SelectField label="Estado" value={v.status} onChange={(e) => set('status', e.target.value as TripStatus)}>
          {(Object.keys(TRIP_STATUS_LABEL) as TripStatus[]).map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
        </SelectField>
      )}
      {showOwnerFields && (
        <div className="check span-2">
          <input id={`${id}-mci`} type="checkbox" checked={v.membersCanInvite} onChange={(e) => set('membersCanInvite', e.target.checked)} />
          <label htmlFor={`${id}-mci`}>Los miembros también pueden invitar</label>
        </div>
      )}
    </form>
  );
}
