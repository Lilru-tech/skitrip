// Configuración local aislada de los E2E. Son valores de prueba, no secretos: solo valen contra el emulador de Auth y
// la D1 local de test/e2e/.state. No dependen de .dev.vars (se pasan con --var, que además tiene prioridad sobre él).
export const E2E_INGEST_TOKEN = 'e2e-ingest-token-not-a-secret';
export const E2E_WORKER_VARS: Record<string, string> = {
  AUTH_MODE: 'emulator',
  FIREBASE_PROJECT_ID: 'demo-skitrip',
  // Vite (5173) reenvía /api al Worker (8787) con changeOrigin, así que el navegador llega con Origin
  // http://localhost:5173 y el Worker lo ve como origen externo: se permite explícitamente, solo aquí.
  ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:8787',
  MAX_PROFILES: '100000',
  INGEST_TOKEN: E2E_INGEST_TOKEN,
};
