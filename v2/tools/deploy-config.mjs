#!/usr/bin/env node
// Genera wrangler.deploy.jsonc (ignorado por git) a partir de wrangler.jsonc para desplegar con Actions:
// sustituye el ID de la D1 y el proyecto de Firebase por los reales. No contiene secretos (los secretos del Worker se
// guardan con `wrangler secret put`, leyendo de stdin). Uso: node tools/deploy-config.mjs <database_id> <firebase_project_id>
import { readFileSync, writeFileSync } from 'node:fs';

const [dbId, projectId] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(dbId ?? '')) throw new Error('database_id no válido');
if (!/^[a-z0-9-]{4,40}$/.test(projectId ?? '') || projectId.startsWith('demo-')) throw new Error('FIREBASE_PROJECT_ID no válido');
const src = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const out = src
  .replace('"database_id": "00000000-0000-0000-0000-000000000000"', `"database_id": "${dbId}"`)
  .replace('"FIREBASE_PROJECT_ID": "skitrip-demo"', `"FIREBASE_PROJECT_ID": "${projectId}"`);
if (out.includes('00000000-0000-0000-0000-000000000000') || out.includes('skitrip-demo')) throw new Error('wrangler.jsonc cambió: no se pudo sustituir la configuración');
writeFileSync(new URL('../wrangler.deploy.jsonc', import.meta.url), out);
console.log('wrangler.deploy.jsonc generado');
