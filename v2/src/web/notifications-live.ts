// Actualización ligera de avisos, sin consultas en segundo plano:
// - la campana pide solo el recuento (GET /api/notifications/unread) cada minuto mientras la pestaña está visible,
//   al volver a ella o recuperar el foco, al navegar y tras acciones de la propia pestaña (announceNotificationsChanged);
// - con la pestaña oculta no se consulta nada;
// - si el recuento cambia, avisa a las páginas abiertas (useNotificationsPulse) para que recarguen sus listas.
import { useEffect, useRef } from 'react';

export const NOTIFICATIONS_POLL_MS = 60_000;
export const CHANGED = 'skitrip:notifications-changed';
export const PULSE = 'skitrip:notifications-pulse';

/** Tras una acción propia (aceptar, rechazar, invitar…): la campana vuelve a contar enseguida. */
export const announceNotificationsChanged = () => window.dispatchEvent(new Event(CHANGED));

/** Llama a `onPulse` cuando la campana detecta un recuento distinto (p. ej. llega una solicitud desde otra sesión). */
export function useNotificationsPulse(onPulse: () => void) {
  const cb = useRef(onPulse);
  cb.current = onPulse;
  useEffect(() => {
    const h = () => cb.current();
    window.addEventListener(PULSE, h);
    return () => window.removeEventListener(PULSE, h);
  }, []);
}

/**
 * Programa las consultas del recuento. Devuelve la función de limpieza. `load` debe ser barata e idempotente; aquí se
 * evita lanzar otra mientras hay una en curso y no se consulta con la pestaña oculta.
 */
export function startUnreadPolling(load: () => Promise<void>, intervalMs = NOTIFICATIONS_POLL_MS): () => void {
  let timer: number | undefined;
  let inflight = false;
  const visible = () => document.visibilityState === 'visible';
  const tick = () => {
    if (inflight || !visible()) return;
    inflight = true;
    void load().finally(() => { inflight = false; });
  };
  const arm = () => {
    window.clearInterval(timer);
    timer = visible() ? window.setInterval(tick, intervalMs) : undefined;
  };
  const onVisibility = () => { arm(); tick(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', tick);
  window.addEventListener(CHANGED, tick);
  arm();
  tick();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', tick);
    window.removeEventListener(CHANGED, tick);
  };
}
