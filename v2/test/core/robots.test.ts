import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows } from '../../src/core/robots';

// Extractos literales de los robots.txt consultados el 01/10/2026 (ver docs/SOURCES.md).
const ESQUIADES = `User-agent: *
Disallow: /admin/
Disallow: /book/
Disallow: /compra/
Disallow: /*/hotel/offer/load
Disallow: /newsletter/

User-agent: BLEXBot
Disallow: /`;
const ESTIBER = `User-agent: *
Disallow: /wp-admin/
Disallow: /*?utm_
Disallow: /listado_hoteles?
Disallow: /online/
Disallow: /csp/online/`;

describe('robots.txt (RFC 9309)', () => {
  it('Esquiades: el buscador y la carga de ofertas están prohibidos; el catálogo no', () => {
    const r = parseRobots(ESQUIADES);
    expect(robotsAllows(r, '/book/hoteles?inicio=2026-12-11')).toBe(false);
    expect(robotsAllows(r, '/es/hotel/offer/load?id=1')).toBe(false);
    expect(robotsAllows(r, '/viajes-esqui/esqui-fin-de-semana-grandvalira-130041')).toBe(true);
    // El comodín a mitad de ruta NO prohíbe todo el sitio (error del recolector anterior).
    expect(robotsAllows(r, '/')).toBe(true);
    // El grupo de BLEXBot no se aplica a SkiTripBot.
    expect(robotsAllows(parseRobots(ESQUIADES, 'blexbot'), '/viajes-esqui/x')).toBe(false);
  });

  it('Estiber: motor de reserva y listados con parámetros prohibidos; páginas de ofertas permitidas', () => {
    const r = parseRobots(ESTIBER);
    expect(robotsAllows(r, '/csp/online/vnew/Booking.CSP?habs=1')).toBe(false);
    expect(robotsAllows(r, '/listado_hoteles?zona=1')).toBe(false);
    expect(robotsAllows(r, '/listado_hoteles')).toBe(true);
    expect(robotsAllows(r, '/es_ES/ofertas-esqui-grandvalira')).toBe(true);
    expect(robotsAllows(r, '/es_ES/ofertas-esqui-grandvalira?utm_source=x')).toBe(false);
  });

  it('gana la regla más larga; Allow gana el empate; «$» ancla el final; grupo propio sustituye a «*»', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\n');
    expect(robotsAllows(r, '/a/x')).toBe(false);
    expect(robotsAllows(r, '/a/b/c')).toBe(true);
    expect(robotsAllows(r, '/doc.pdf')).toBe(false);
    expect(robotsAllows(r, '/doc.pdf?x=1')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /p\nAllow: /p\n'), '/p')).toBe(true);
    const own = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: SkiTripBot\nDisallow: /privado\n');
    expect(robotsAllows(own, '/publico')).toBe(true);
    expect(robotsAllows(own, '/privado/x')).toBe(false);
    expect(robotsAllows(parseRobots(''), '/x')).toBe(true);
  });
});
