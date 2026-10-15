import { describe, expect, it } from 'vitest';
import { isolateSummary, normPath, parseTail, probeInfo } from '../../tools/cpu-summary';

describe('resumen de CPU', () => {
  it('lee la salida de wrangler tail con objetos en varias líneas y texto ajeno', () => {
    const text = `Connected to skitrip\n{\n  "outcome": "ok", "cpuTime": 3, "eventTimestamp": 1,\n  "event": { "request": { "url": "https://x/api/trips/0d4c4f7e-8a3b-4b39-9d0e-1f2a3b4c5d6e", "method": "GET" } },\n  "logs": [{ "message": ["a } b \\" {"] }]\n}\n{"outcome":"exceededCpu","cpuTime":12,"eventTimestamp":2,"event":{"request":{"url":"https://x/api/health","method":"GET"}}}`;
    const ev = parseTail(text);
    expect(ev.map((e) => e.outcome)).toEqual(['ok', 'exceededCpu']);
    expect(normPath(ev[0].event.request.url)).toBe('/api/trips/:id');
  });

  it('lee la línea de diagnóstico del isolate y distingue isolate nuevo de uno ya usado', () => {
    const ev = (isolate: string, n: number) => ({ logs: [{ message: ['otra cosa'] }, { message: [JSON.stringify({ probe: 1, isolate, n, ageMs: n * 10 })] }] });
    expect(probeInfo(ev('ab12', 3))).toEqual({ isolate: 'ab12', n: 3, ageMs: 30 });
    expect(probeInfo({ logs: [{ message: ['{"probe": "x"}'] }] })).toBeNull();
    expect(isolateSummary([ev('a', 1), ev('a', 2), ev('b', 1)])).toBe('nuevo · 2 · 2');
    expect(isolateSummary([ev('a', 41), ev('a', 42)])).toBe('n=41 · 1 · 0');
    expect(isolateSummary([{}])).toBe('—');
  });
});
