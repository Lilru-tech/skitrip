// Interfaz para fuentes de precios de supermercado AUTORIZADAS.
//
// El adaptador directo de Mercadona está DESHABILITADO y no tiene implementación de captura:
// sus condiciones (https://tienda.mercadona.es/legal/terms/es/) prohíben extraer información por
// medios automatizados y no hay permiso del titular. Que un endpoint responda no lo convierte en una
// API pública autorizada. Tampoco se sustituye por un proxy o una extensión que haga lo mismo.
//
// Para activarlo haría falta: (1) permiso escrito de Mercadona o una fuente licenciada que publique
// sus precios; (2) revisar las condiciones de esa licencia; (3) implementar `fetchPrices` contra esa
// fuente, con límite de frecuencia y caché; (4) cambiar `enabled` tras una revisión explícita.

export interface PriceQuote {
  retailerRef: string;
  ean: string | null;
  amountCents: number;
  observedOn: string;
  priceType: 'shelf' | 'promo';
  postalCode: string | null;
  channel: 'online' | 'store';
}

export interface PriceProvider {
  id: string;
  name: string;
  enabled: boolean;
  licence: string | null;
  disabledReason?: string;
  fetchPrices(refs: string[], postalCode: string): Promise<PriceQuote[]>;
}

export const mercadonaDirect: PriceProvider = {
  id: 'mercadona-direct',
  name: 'Mercadona (directo)',
  enabled: false,
  licence: null,
  disabledReason: 'Sin autorización: las condiciones de Mercadona prohíben la extracción automatizada.',
  async fetchPrices() {
    throw new Error('Proveedor deshabilitado: falta autorización o fuente licenciada.');
  },
};

export const PRICE_PROVIDERS: PriceProvider[] = [mercadonaDirect];

export function enabledProviders(): PriceProvider[] {
  return PRICE_PROVIDERS.filter((p) => p.enabled);
}
