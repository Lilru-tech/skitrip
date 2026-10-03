// Motivo de una captura sin ofertas: la ausencia confirmada y el fuera de temporada no cuentan como fallos seguidos;
// la estructura desconocida sí. Cero nunca deja la ejecución como correcta.
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../data/catalog.json';
import { seedCatalog } from './helpers';

const ingest = async (body: unknown) => {
  const r = await SELF.fetch('http://localhost/api/ingest/offers', { method: 'POST', headers: { Authorization: 'Bearer test-ingest-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json<any>() };
};
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, pipeline: 'offers', startedAt: Date.now() - 5000, finishedAt: Date.now(), expected: 2, ok: 0, failed: 0, unsupported: 0, ...over });
const health = (id: string) => env.DB.prepare('SELECT last_status, reason, consecutive_fail FROM source_health WHERE source_id = ?1').bind(id).first<any>();

beforeAll(async () => {
  await seedCatalog(env.DB, catalog as any);
});

describe('motivo de cero ofertas', () => {
  it('sin ofertas confirmado no suma fallos; formato desconocido sí; la ejecución no queda correcta', async () => {
    let t = Date.now() - 10 * 60_000;
    for (let i = 0; i < 3; i++) {
      t += 60_000;
      const r = await ingest({ run: run(`reasons-${i}`, { failed: 1 }), observedAt: t, results: [], catalog: [], health: [
        { sourceId: 'offers-port-del-comte', status: 'empty', reason: 'off_season', error: 'fuera de temporada', attemptedAt: t },
        { sourceId: 'offers-baqueira-beret', status: 'error', reason: 'unknown_structure', error: 'formato', attemptedAt: t },
      ] });
      expect(r.status).toBe(200);
      expect(r.json.runStatus).not.toBe('ok');
    }
    expect(await health('offers-port-del-comte')).toEqual({ last_status: 'empty', reason: 'off_season', consecutive_fail: 0 });
    expect(await health('offers-baqueira-beret')).toEqual({ last_status: 'error', reason: 'unknown_structure', consecutive_fail: 3 });

    // Solo ausencias confirmadas: ni ok ni fallos → «empty», nunca «ok».
    t += 60_000;
    const empty = await ingest({ run: run('reasons-empty'), observedAt: t, results: [], catalog: [], health: [
      { sourceId: 'offers-port-del-comte', status: 'empty', reason: 'no_offers', attemptedAt: t },
    ] });
    expect(empty.json.runStatus).toBe('empty');

    // Un éxito posterior borra el motivo.
    t += 60_000;
    await ingest({ run: run('reasons-ok', { ok: 1, expected: 1 }), observedAt: t, results: [], catalog: [], health: [{ sourceId: 'offers-baqueira-beret', status: 'ok', attemptedAt: t }] });
    expect(await health('offers-baqueira-beret')).toEqual({ last_status: 'ok', reason: null, consecutive_fail: 0 });
  });

  it('rechaza motivos desconocidos', async () => {
    const t = Date.now();
    const r = await ingest({ run: run('reasons-bad'), observedAt: t, results: [], catalog: [], health: [{ sourceId: 'offers-port-del-comte', status: 'empty', reason: 'parece_vacia', attemptedAt: t }] });
    expect(r.status).toBe(422);
  });
});
