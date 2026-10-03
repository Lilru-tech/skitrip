// Configuración pública del cliente, fijada en el build (no son secretos).
import { parseApiOrigin } from './api-origin';

export const apiOrigin = parseApiOrigin(import.meta.env.VITE_API_BASE_URL);
