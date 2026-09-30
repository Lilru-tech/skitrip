// Capacidades REALES por proveedor y modalidad. Se publican en la API y la interfaz las muestra antes de crear una
// búsqueda: nunca se promete un resultado de un adaptador que no existe ni se atribuye al proveedor una limitación nuestra.
export type CapabilityState =
  | 'implemented_verified'     // adaptador probado contra la web real, con registro de verificación
  | 'implemented_unverified'   // adaptador probado solo con fixtures; pendiente de la primera ejecución online
  | 'not_implemented'          // no hay adaptador (falta implementarlo o verificar el formato de búsqueda)
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

const NOT_YET = 'La búsqueda automática por fechas no está implementada: falta verificar el formato de búsqueda de este proveedor. Usa el enlace para consultar y guarda la cotización a mano.';

export const CAPABILITIES: ProviderCapability[] = [
  { provider: 'esquiades', label: 'Esquiades', modality: 'lodging', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: NOT_YET },
  { provider: 'esquiades', label: 'Esquiades', modality: 'lodging_forfait', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: NOT_YET },
  { provider: 'estiber', label: 'Estiber', modality: 'lodging', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: NOT_YET },
  { provider: 'estiber', label: 'Estiber', modality: 'lodging_forfait', catalogPrices: 'implemented_unverified', dateSearch: 'not_implemented', manualQuote: 'available', note: NOT_YET },
  { provider: 'manual', label: 'Cotización manual', modality: 'lodging', catalogPrices: 'not_implemented', dateSearch: 'not_implemented', manualQuote: 'available', note: 'Cualquier alojamiento: introduce precio, unidad y condiciones exactas de la cotización.' },
  { provider: 'manual', label: 'Cotización manual', modality: 'lodging_forfait', catalogPrices: 'not_implemented', dateSearch: 'not_implemented', manualQuote: 'available', note: 'Cualquier paquete: introduce precio, unidad, condiciones y días de forfait incluidos.' },
];

export const dateSearchAvailable = (provider: string, modality: string) =>
  CAPABILITIES.some((c) => c.provider === provider && c.modality === modality && (c.dateSearch === 'implemented_verified' || c.dateSearch === 'implemented_unverified'));
