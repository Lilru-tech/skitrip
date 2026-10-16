import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

/** Carga asíncrona con estados de carga/error y recarga manual. Mantiene los datos previos al recargar. */
export function useResource<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await run();
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/**
 * Carga asociada a una clave (p. ej. viaje + origen + transporte). A diferencia de useResource, no conserva datos de
 * otra clave: `data` solo se devuelve si corresponde a la clave actual. Mientras llega la respuesta de la clave nueva,
 * o si falla, `data` es null (nunca se muestran ni puntúan datos de la selección anterior). Las respuestas que llegan
 * tarde para una clave ya abandonada se descartan.
 */
export function useKeyedResource<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    const my = ++seq.current;
    if (key === null) { setState({ key: null, data: null, error: null }); return; }
    setState((s) => (s.key === key ? { ...s, error: null } : { key, data: null, error: null }));
    try {
      const d = await loadRef.current();
      if (my === seq.current) setState({ key, data: d, error: null });
    } catch (e) {
      if (my === seq.current) setState({ key, data: null, error: errorMessage(e) });
    }
  }, [key]);
  useEffect(() => { void reload(); }, [reload]);
  const current = state.key === key && key !== null;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: key !== null && (!current || (state.data === null && state.error === null)),
    reload,
  };
}

/** Ejecuta una acción con estado «ocupado» para deshabilitar botones mientras dura. */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}
