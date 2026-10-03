// Avisos breves. La región es role=status (educada); los errores usan role=alert dentro.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'error' | 'info';
interface ToastItem { id: number; text: string; tone: Tone; action?: { label: string; run: () => void } }
interface ToastApi { show: (text: string, tone?: Tone, action?: ToastItem['action']) => void }

const Ctx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>((text, tone = 'ok', action) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, tone, action }]);
    window.setTimeout(() => dismiss(id), action ? 9000 : tone === 'error' ? 7000 : 4000);
  }, [dismiss]);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.text}</span>
            {t.action && (
              <button type="button" className="btn btn-small btn-ghost-inverse" onClick={() => { dismiss(t.id); t.action!.run(); }}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
