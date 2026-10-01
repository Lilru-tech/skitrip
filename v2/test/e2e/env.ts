// Configuración local aislada de los E2E. Son valores de prueba, no secretos: solo valen contra el emulador de Auth y
// la D1 local de test/e2e/.state. No dependen de .dev.vars (se pasan con --var, que además tiene prioridad sobre él).
export const E2E_INGEST_TOKEN = 'e2e-ingest-token-not-a-secret';
export const E2E_WORKER_VARS: Record<string, string> = {
  AUTH_MODE: 'emulator',
  FIREBASE_PROJECT_ID: 'demo-skitrip',
  // Vite (5173) reenvía /api al Worker (8787) con changeOrigin, así que el navegador llega con Origin
  // http://localhost:5173 y el Worker lo ve como origen externo: se permite explícitamente, solo aquí.
  // El build de Pages de prueba (vite preview en 4173, base /skitrip/) llama a la API en 8787: otro origen, como
  // github.io → workers.dev en producción.
  ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:8787,http://localhost:4173',
  MAX_PROFILES: '100000',
  INGEST_TOKEN: E2E_INGEST_TOKEN,
};

/** Build de prueba de Pages: base /skitrip/, API en otro origen y CSP en <meta>, contra el emulador de Auth. */
export const PAGES_TEST_ENV: Record<string, string> = {
  SKITRIP_TARGET: 'pages', SKITRIP_PAGES_TEST: '1', VITE_USE_AUTH_EMULATOR: '1', VITE_API_BASE_URL: 'http://localhost:8787',
};
export const PAGES_URL = 'http://localhost:4173/skitrip/';
