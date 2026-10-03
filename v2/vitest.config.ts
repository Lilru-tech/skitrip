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
          bindings: { TEST_MIGRATIONS: migrations, AUTH_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-skitrip', ALLOWED_ORIGINS: 'http://localhost:5173,https://lilru-tech.github.io', MAX_PROFILES: '50', INGEST_TOKEN: 'test-ingest-token' },
        },
      }),
    ],
    test: {
      include: ['test/worker/**/*.test.ts', 'test/core/**/*.test.ts'],
      setupFiles: ['./test/worker/apply-migrations.ts'],
    },
  };
});
