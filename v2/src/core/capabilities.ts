// Capacidades REALES por proveedor y modalidad. Se publican en la API y la interfaz las muestra antes de crear una
// búsqueda: nunca se promete un resultado de un adaptador que no existe ni se atribuye al proveedor una limitación nuestra.
export type CapabilityState =
  | 'implemented_verified'     // adaptador probado contra la web real, con registro de verificación
  | 'implemented_unverified'   // adaptador probado solo con fixtures; pendiente de la primera ejecución online
  | 'not_implemented'          // no hay adaptador (no implementado o la fuente no permite automatizarlo)
  | 'available';               // disponible sin integración (p. ej. cotización manual)

export interface ProviderCapability {
  provider: 'esquiades' | 'estiber' | 'manual';
  label: string;
  modality: 'lodging' | 'lodging_forfait';
  catalogPrices: CapabilityState;   // precios «desde» de las páginas de estación (orientativos)
  dateSearch: CapabilityState;      // búsqueda por fechas y ocupación de un viaje
  manualQuote: CapabilityState;     // enlace para consultar + cotización introducida por el grupo
  note: string;
}

// Comprobado el 01/10/2026 (docs/SOURCES.md): el buscador por fechas y ocupación de ambos proveedores está en rutas
// que su robots.txt prohíbe a los programas. No se automatiza; se ofrece el enlace y la cotización manual.
const ROBOTS_NOTE = (label: string, path: string) =>
  `La búsqueda automática por fechas no se hace: el robots.txt de ${label} prohíbe a los programas su buscador (${path}), comprobado el 01/10/2026. Abre el enlace, busca vuestras fechas y guarda la cotización a mano.`;
const ESQUIADES_NOTE = ROBOTS_NOTE('Esquiades', '/book/');
const ESTIBER_NOTE = ROBOTS_NOTE('Estiber', '/csp/online/');

export const CAPABILITIES: ProviderCapability[] = [
  { provider: 'esquiades', label: 'Esquiades', modality: 'lodging', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: ESQUIADES_NOTE },
  { provider: 'esquiades', label: 'Esquiades', modality: 'lodging_forfait', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: ESQUIADES_NOTE },
  { provider: 'estiber', label: 'Estiber', modality: 'lodging', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: ESTIBER_NOTE },
  { provider: 'estiber', label: 'Estiber', modality: 'lodging_forfait', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: ESTIBER_NOTE },
  { provider: 'manual', label: 'Cotización manual', modality: 'lodging', catalogPrices: 'not_implemented', dateSearch: 'not_implemented', manualQuote: 'available', note: 'Cualquier alojamiento: introduce precio, unidad y condiciones exactas de la cotización.' },
  { provider: 'manual', label: 'Cotización manual', modality: 'lodging_forfait', catalogPrices: 'not_implemented', dateSearch: 'not_implemented', manualQuote: 'available', note: 'Cualquier paquete: introduce precio, unidad, condiciones y días de forfait incluidos.' },
];

export const dateSearchAvailable = (provider: string, modality: string) =>
  CAPABILITIES.some((c) => c.provider === provider && c.modality === modality && (c.dateSearch === 'implemented_verified' || c.dateSearch === 'implemented_unverified'));

/** Explicación para una búsqueda sin automatización: la del proveedor si existe, o una genérica. */
export const dateSearchNote = (provider: string, modality: string) =>
  CAPABILITIES.find((c) => c.provider === provider && c.modality === modality)?.note
  ?? 'La búsqueda automática por fechas no está implementada para este proveedor: consulta con el enlace y guarda la cotización a mano.';
