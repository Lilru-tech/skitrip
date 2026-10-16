// Origen personalizado (dirección o punto del mapa). Privado por defecto: vive en memoria de esta pestaña y solo se
// guarda en este navegador si la persona lo pide («Recordar en este navegador»). Nunca va en la URL (la URL solo dice
// `origen=personal`), ni se envía a SkiTrip salvo en el cuerpo de las peticiones de rutas y costes.
import { useSyncExternalStore } from 'react';
import type { Route } from './catalog';

export interface CustomRoute {
  areaId: string; accessName: string; lastLeg: 'rack_railway' | null; roadKm: number | null; durationMin: number | null; notes: string | null;
  /** Grado de confirmación del punto de llegada (catalog_center = punto central del catálogo, no un acceso). */
  access?: { confidence: 'contrasted' | 'single_source' | 'approximate' | 'catalog_center'; source: string | null; checkedOn: string | null };
}
export interface CustomOrigin {
  label: string; lat: number; lon: number;
  /** Rutas calculadas para este punto (se reutilizan sin volver a consultar al proveedor). */
  routes: CustomRoute[]; checkedOn: string; attribution: string;
  /** Peajes por coche (ida y vuelta) desde este punto a cada estación, indicados por la persona; sin entrada = pendientes. */
  tollsByArea: Record<string, number | null>;
  remembered: boolean;
}

const KEY = 'skitrip.customOrigin.v1';
/** Tras este tiempo un origen recordado vuelve a pedir rutas (cambian poco, pero no se dan por buenas para siempre). */
const MAX_AGE_DAYS = 30;

function load(): CustomOrigin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CustomOrigin;
    if (!Number.isFinite(o?.lat) || !Number.isFinite(o?.lon) || !Array.isArray(o.routes)) return null;
    // Peajes solo por recorrido; un dato antiguo de peaje único no se traslada a ninguna estación.
    const tollsByArea = o.tollsByArea && typeof o.tollsByArea === 'object' ? o.tollsByArea : {};
    const { tollsCentsPerCar: _old, ...rest } = o as CustomOrigin & { tollsCentsPerCar?: unknown };
    if (Date.now() - Date.parse(o.checkedOn) > MAX_AGE_DAYS * 86400_000) return { ...rest, tollsByArea, routes: [], remembered: true };
    return { ...rest, tollsByArea, remembered: true };
  } catch {
    return null;
  }
}

let current: CustomOrigin | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getCustomOrigin(): CustomOrigin | null {
  if (current === undefined) current = load();
  return current;
}

export function setCustomOrigin(o: CustomOrigin | null) {
  current = o;
  try {
    if (o?.remembered) localStorage.setItem(KEY, JSON.stringify(o));
    else localStorage.removeItem(KEY);
  } catch { /* sin almacenamiento: queda solo en memoria */ }
  emit();
}

export function useCustomOrigin(): CustomOrigin | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getCustomOrigin, () => null);
}

/** Rutas del origen personalizado con la forma de las del catálogo (peajes siempre sin confirmar). */
export function customRouteMap(o: CustomOrigin): Map<string, Route> {
  return new Map(o.routes.map((r) => [r.areaId, {
    accessName: r.accessName, roadKm: r.roadKm, durationMin: r.durationMin, tollCents: null,
    source: 'Geoapify (OpenStreetMap)', checkedOn: o.checkedOn, validated: false,
    notes: r.notes ?? (r.lastLeg === 'rack_railway' ? 'Sin acceso en coche: el último tramo es en cremallera.' : null),
  }]));
}

/** Coordenadas con 3 decimales (unos 100 m) para mostrar un punto del mapa sin más precisión de la necesaria. */
export const pointLabel = (lat: number, lon: number) => `Punto del mapa (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
