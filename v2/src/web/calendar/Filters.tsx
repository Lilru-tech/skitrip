// Filtros de la vista común: noches y mínimo de personas.
import { useId } from 'react';

export interface GroupFilters { nights: number; mode: 'all' | 'min'; min: number }

export function FiltersForm({ value, onChange, maxPeople }: { value: GroupFilters; onChange: (v: GroupFilters) => void; maxPeople: number }) {
  const id = useId();
  return (
    <div className="filters">
      <div className="field field-inline">
        <label htmlFor={`${id}-n`}>Noches</label>
        <input id={`${id}-n`} type="number" inputMode="numeric" min={0} max={30} value={value.nights}
          onChange={(e) => onChange({ ...value, nights: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
      </div>
      <fieldset className="radio-group">
        <legend>Personas disponibles</legend>
        <label className="radio"><input type="radio" name={`${id}-m`} checked={value.mode === 'all'} onChange={() => onChange({ ...value, mode: 'all' })} /> Todas las que comparten</label>
        <label className="radio"><input type="radio" name={`${id}-m`} checked={value.mode === 'min'} onChange={() => onChange({ ...value, mode: 'min' })} /> Mínimo</label>
        <label className="visually-hidden" htmlFor={`${id}-min`}>Mínimo de personas</label>
        <input id={`${id}-min`} className="input-narrow" type="number" inputMode="numeric" min={1} max={Math.max(1, maxPeople)} value={value.min}
          disabled={value.mode !== 'min'} onChange={(e) => onChange({ ...value, min: Math.max(1, Number(e.target.value) || 1) })} />
      </fieldset>
    </div>
  );
}
