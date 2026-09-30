import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function Field({ label, hint, error, id, className, ...input }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={fid}>{label}</label>
      <input id={fid} aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined} aria-invalid={error ? true : undefined} {...input} />
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errId}>{error}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label: string; hint?: ReactNode; children: ReactNode }
export function SelectField({ label, hint, id, children, className, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={fid}>{label}</label>
      <select id={fid} aria-describedby={hintId} {...rest}>{children}</select>
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
    </div>
  );
}
