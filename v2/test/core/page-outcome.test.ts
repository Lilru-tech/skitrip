import { describe, expect, it } from 'vitest';
import { classifyEmptyOffersPage } from '../../src/core/page-outcome';
import { parseOfferCardsHtml } from '../../src/core/parsers/offers';
import baqueira from '../fixtures/real/estiber-offers-baqueira-beret.2026-10-03.html?raw';
import portDelComte from '../fixtures/real/estiber-offers-port-del-comte.2026-10-03.html?raw';

const page = (main: string) => `<html><body><nav>Ofertas de esquí Andorra</nav><main>${main}</main><script>var p = "199 €";</script></body></html>`;

describe('motivo de una página sin tarjetas con precio', () => {
  it('la página dice que no hay resultados → sin ofertas confirmado', () => {
    expect(classifyEmptyOffersPage(page('<p>No hemos encontrado ningún resultado</p>'))).toBe('no_offers');
  });
  it('apertura prevista y ningún precio → fuera de temporada', () => {
    expect(classifyEmptyOffersPage(page('<div>Cerrada · Apertura prevista el 28/11/2026</div>'))).toBe('off_season');
  });
  it('precios visibles sin tarjetas reconocidas → formato desconocido, aunque diga «no hay ofertas»', () => {
    expect(classifyEmptyOffersPage(page('<div class="x">Hotel Y 2 noches 199 € por persona</div>'))).toBe('unknown_structure');
    expect(classifyEmptyOffersPage(page('<p>No hay ofertas</p><div>Otras: desde 150 €</div>'))).toBe('unknown_structure');
  });
  it('sin precio y sin aviso propio → formato desconocido (cero no es éxito ni ausencia probada)', () => {
    expect(classifyEmptyOffersPage(page('<div>Ofertas de esquí en Port del Comte</div>'))).toBe('unknown_structure');
  });
  it('el robots.txt impidió cargar algo que no es analítica → no se puede leer, no es ausencia', () => {
    expect(classifyEmptyOffersPage(page('<p>No hemos encontrado ningún resultado</p>'), ['/es/hotel/offer/load'])).toBe('robots_subrequests');
    expect(classifyEmptyOffersPage(page('<p>No hemos encontrado ningún resultado</p>'), ['/ccm/collect', '/stats/TrustboxImpression', '/events/2c8a'])).toBe('no_offers');
  });
  it('los precios dentro de scripts no cuentan', () => {
    expect(classifyEmptyOffersPage(page('<p>Apertura prevista el 28/11/2026</p>'))).toBe('off_season');
  });
});

describe('capturas reales de Estiber sin ofertas (03/10/2026)', () => {
  it('Baqueira: ninguna tarjeta; los 15 € son del texto (aparcamiento y forfait de temporada) → fuera de temporada', () => {
    expect(parseOfferCardsHtml(baqueira, 'estiber').filter((c) => c.amount)).toHaveLength(0);
    expect((baqueira.match(/€/g) ?? []).length).toBeGreaterThan(5);
    expect(classifyEmptyOffersPage(baqueira)).toBe('off_season');
  });
  it('Port del Comte: ninguna tarjeta ni precio y la estación figura cerrada → fuera de temporada', () => {
    expect(parseOfferCardsHtml(portDelComte, 'estiber').filter((c) => c.amount)).toHaveLength(0);
    expect(classifyEmptyOffersPage(portDelComte)).toBe('off_season');
  });
  it('la misma página con una tarjeta de precio que no reconocemos deja de ser «fuera de temporada»', () => {
    expect(classifyEmptyOffersPage(baqueira.replace('</body>', '<div class="nueva">Hotel Montarto 2 noches Por 410€ por persona</div></body>'))).toBe('unknown_structure');
  });
});

describe('mensaje fijo del buscador de Esquiades', () => {
  // Texto real de la cabecera de esquiades.com (03/10/2026), presente en todas sus páginas, también con ofertas o datos.
  const widget = '<div class="search-empty">¡Vaya! No hemos encontrado ningún resultado que coincida con tu búsqueda. Prueba a modificar el destino.</div>';
  it('no cuenta como «no hay ofertas»: sin otro aviso, la página es de formato no reconocido', () => {
    expect(classifyEmptyOffersPage(`<html><body>${widget}<main><h1>Esquí en Grandvalira</h1></main></body></html>`)).toBe('unknown_structure');
  });
  it('un aviso propio de la página sigue contando', () => {
    expect(classifyEmptyOffersPage(`<html><body>${widget}<main><p>No hay ofertas para estas fechas.</p></main></body></html>`)).toBe('no_offers');
  });
});
