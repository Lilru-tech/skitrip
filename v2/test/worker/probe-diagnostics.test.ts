// La línea de diagnóstico de isolate solo aparece en las peticiones de la medición (cabecera X-SkiTrip-Probe).
import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('diagnóstico de isolate para la medición de CPU', () => {
  it('con la cabecera: una línea JSON con isolate y número de petición creciente; sin ella, nada', async () => {
    const log = vi.spyOn(console, 'log');
    await SELF.fetch('http://localhost/api/health');
    expect(log.mock.calls.filter((c) => String(c[0]).includes('"probe"'))).toHaveLength(0);
    await SELF.fetch('http://localhost/api/health', { headers: { 'X-SkiTrip-Probe': '1' } });
    await SELF.fetch('http://localhost/api/health', { headers: { 'X-SkiTrip-Probe': '1' } });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"probe"')).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ probe: 1, isolate: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(lines[1].isolate).toBe(lines[0].isolate);
    expect(lines[1].n).toBe(lines[0].n + 1);
    expect(Object.keys(lines[0]).sort()).toEqual(['ageMs', 'isolate', 'n', 'probe']);
  });
});
