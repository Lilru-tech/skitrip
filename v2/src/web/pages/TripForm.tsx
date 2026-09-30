// Formulario de viaje (crear/editar). Los valores se mantienen si la red falla.
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../components/Field';
import { TRIP_STATUS_LABEL } from '../format';
import type { Trip, TripStatus } from '../types';

export interface TripFormValues {
  name: string; startDate: string; endDate: string; nights: string; participantsPlanned: string; budgetEuros: string;
  status: TripStatus; membersCanInvite: boolean;
}

export const emptyTripForm = (): TripFormValues => ({ name: '', startDate: '', endDate: '', nights: '', participantsPlanned: '', budgetEuros: '', status: 'planning', membersCanInvite: false });

export const tripToForm = (t: Trip): TripFormValues => ({
  name: t.name, startDate: t.startDate ?? '', endDate: t.endDate ?? '', nights: t.nights?.toString() ?? '',
  participantsPlanned: t.participantsPlanned?.toString() ?? '',
  budgetEuros: t.budgetCents != null ? (t.budgetCents / 100).toString().replace('.', ',') : '',
  status: t.status, membersCanInvite: t.membersCanInvite,
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
  return null;
}

/** Diferencias entre lo que el usuario había escrito y la versión recargada (para no perder nada en silencio). */
export function diffForms(mine: TripFormValues, latest: TripFormValues): string[] {
  const labels: Record<keyof TripFormValues, string> = {
    name: 'Nombre', startDate: 'Ida', endDate: 'Vuelta', nights: 'Noches', participantsPlanned: 'Personas previstas', budgetEuros: 'Presupuesto (€)',
    status: 'Estado', membersCanInvite: 'Miembros pueden invitar',
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
}

export function TripForm({ id, values: v, onChange, onSubmit, showStatus, showOwnerFields }: Props) {
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof TripFormValues>(k: K, val: TripFormValues[K]) => onChange({ ...v, [k]: val });
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); onSubmit(); };
  return (
    <form id={id} className="form-grid" onSubmit={submit} noValidate>
      <Field className="span-2" label="Nombre del viaje" required maxLength={120} value={v.name} onChange={(e) => set('name', e.target.value)}
        error={touched && !v.name.trim() ? 'Obligatorio.' : null} placeholder="Por ejemplo: Puente de diciembre" />
      <Field label="Ida" type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} hint="Opcional" />
      <Field label="Vuelta" type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} hint="Opcional" />
      <Field label="Noches" type="number" inputMode="numeric" min={0} max={60} value={v.nights} onChange={(e) => set('nights', e.target.value)} hint="Para buscar ventanas en el calendario" />
      <Field label="Personas previstas" type="number" inputMode="numeric" min={1} max={60} value={v.participantsPlanned} onChange={(e) => set('participantsPlanned', e.target.value)} />
      <Field label="Presupuesto por persona (€)" inputMode="decimal" value={v.budgetEuros} onChange={(e) => set('budgetEuros', e.target.value)} hint="Opcional, en euros" />
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
