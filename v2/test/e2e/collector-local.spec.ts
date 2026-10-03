import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// El recolector normal (withBrowser → detector de bloqueo → analizador de tarjetas) de principio a fin contra un
// servidor LOCAL que sirve el fixture de Estiber (reconstruido; ver su cabecera) con un robots.txt como el real
// (Disallow: /csp/online/). No sale a internet: la comprobación contra estiber.com es «v2 · comprobar fuentes online».
const fixture = readFileSync('test/fixtures/parsers/estiber-la-molina.reconstruido.html', 'utf8');
const challenge = '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-form">Checking your browser</div></body></html>';

let server: Server;
let origin = '';
const hits: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    const send = (status: number, body: string, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
    if (req.url === '/robots.txt') return send(200, 'User-agent: *\nDisallow: /csp/online/\n', 'text/plain');
    // El fixture enlaza a https://www.estiber.com; se reescribe al servidor local para que sean del mismo host.
    if (req.url === '/es_ES/ofertas-esqui-la-molina') return send(200, fixture.replaceAll('https://www.estiber.com', origin) + `<script>fetch('/csp/online/vnew/Booking.CSP?x=1')</script>`);
    if (req.url === '/desafio') return send(503, challenge);
    if (req.url === '/prohibido') return send(403, '<p>Forbidden</p>');
    return send(404, 'no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  if (process.env.PW_CHROMIUM_PATH) process.env.CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

test('recolector local: extrae las tarjetas de Estiber, respeta robots.txt y se para ante un bloqueo', async ({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'No depende del tamaño de pantalla: se ejecuta una vez.');
  const { withBrowser, BlockedError, allowedByRobots } = await import('../../tools/collectors/lib.ts');
  const { parseOfferCardsHtml } = await import('../../src/core/parsers/offers.ts');

  const url = `${origin}/es_ES/ofertas-esqui-la-molina`;
  expect(await allowedByRobots(url)).toBe(true);
  expect(await allowedByRobots(`${origin}/csp/online/vnew/Booking.CSP`)).toBe(false);

  const result = await withBrowser(async (load) => {
    const cards = parseOfferCardsHtml(await load(url), 'estiber');
    const errors: string[] = [];
    for (const path of ['/desafio', '/prohibido']) {
      try { await load(`${origin}${path}`); errors.push(`${path}: sin error`); } catch (e) { errors.push(`${path}: ${e instanceof BlockedError ? 'bloqueo' : 'otro'} ${(e as Error).message}`); }
    }
    return { cards, errors };
  });

  expect(result.cards.map((c) => [c.hotelName, c.amount?.cents, c.unit, c.nights, c.forfaitDays, c.checkIn])).toEqual([
    ['Basecamps Cerdanya', 68400, 'per_person', 4, 3, '2026-12-04'],
    ['Puigcerdà Park Hotel & Spa', 42100, 'per_person', 4, 3, '2026-12-04'],
  ]);
  expect(result.errors[0]).toMatch(/^\/desafio: bloqueo .*título «Just a moment/);
  expect(result.errors[1]).toMatch(/^\/prohibido: bloqueo .*HTTP 403/);
  // La petición que hace la página a /csp/online/ se corta antes de salir (robots.txt).
  expect(hits.some((h) => h.startsWith('/csp/online/'))).toBe(false);
});
