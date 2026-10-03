import { describe, expect, it } from 'vitest';
import { normPath, parseTail } from '../../tools/cpu-summary';

describe('resumen de CPU', () => {
  it('lee la salida de wrangler tail con objetos en varias líneas y texto ajeno', () => {
    const text = `Connected to skitrip\n{\n  "outcome": "ok", "cpuTime": 3, "eventTimestamp": 1,\n  "event": { "request": { "url": "https://x/api/trips/0d4c4f7e-8a3b-4b39-9d0e-1f2a3b4c5d6e", "method": "GET" } },\n  "logs": [{ "message": ["a } b \\" {"] }]\n}\n{"outcome":"exceededCpu","cpuTime":12,"eventTimestamp":2,"event":{"request":{"url":"https://x/api/health","method":"GET"}}}`;
    const ev = parseTail(text);
    expect(ev.map((e) => e.outcome)).toEqual(['ok', 'exceededCpu']);
    expect(normPath(ev[0].event.request.url)).toBe('/api/trips/:id');
  });
});
