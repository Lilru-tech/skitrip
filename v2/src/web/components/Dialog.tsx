// Diálogo modal con <dialog>.showModal(): el resto de la página queda inerte, Escape cierra,
// el foco se mantiene dentro y vuelve al elemento que lo abrió al cerrarse.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Close } from './Icons';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pie con acciones. */
  footer?: ReactNode;
  size?: 'normal' | 'wide';
  /** Bloquea el cierre (p. ej. mientras se guarda). */
  busy?: boolean;
}

export function Dialog({ open, title, onClose, children, footer, size = 'normal', busy }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      // Primer campo o botón útil; si no, el propio diálogo.
      const first = d.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea');
      (first ?? d.querySelector<HTMLElement>('.dialog-body button, .dialog-footer button') ?? d).focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!busyRef.current) closeRef.current();
    };
    const onClosed = () => {
      const el = opener.current;
      opener.current = null;
      if (el && document.contains(el)) requestAnimationFrame(() => el.focus());
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClosed);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClosed);
    };
  }, []);

  // Si se desmonta abierto, devolver el foco igualmente.
  useEffect(() => () => {
    const el = opener.current;
    if (el && document.contains(el)) el.focus();
  }, []);

  return (
    <dialog ref={ref} className={`dialog dialog-${size}`} aria-labelledby={titleId} aria-modal="true"
      onMouseDown={(e) => { if (e.target === ref.current && !busy) onClose(); }}>
      {open && (
        <div className="dialog-inner">
          <div className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} disabled={busy}><Close /></button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmación sencilla para acciones con consecuencias. */
export function ConfirmDialog(props: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void; error?: string | null;
}) {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onClose} busy={props.busy}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={props.onClose} disabled={props.busy}>Cancelar</button>
        <button type="button" data-autofocus className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm} disabled={props.busy} aria-busy={props.busy || undefined}>
          {props.busy ? 'Un momento…' : props.confirmLabel}
        </button>
      </>}>
      <div className="stack-s">{props.body}</div>
      {props.error && <p className="form-error" role="alert">{props.error}</p>}
    </Dialog>
  );
}
