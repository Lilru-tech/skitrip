import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, AUTH_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-skitrip', ALLOWED_ORIGINS: 'http://localhost:5173,https://lilru-tech.github.io', MAX_PROFILES: '50', INGEST_TOKEN: 'test-ingest-token',
            GEOAPIFY_API_KEY: 'test-geo-key', GEOAPIFY_BASE_URL: 'https://geo.mock', GEO_DAILY_CREDITS: '100', GEO_USER_DAILY_CREDITS: '40' },
        },
      }),
    ],
    test: {
      include: ['test/worker/**/*.test.ts', 'test/core/**/*.test.ts'],
      setupFiles: ['./test/worker/apply-migrations.ts'],
    },
  };
});
