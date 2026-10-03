// Listas generales de la compra: reglas puras (sin D1) para la hoja antigua, lo que le falta a cada artículo y la
// copia a un viaje con sus coincidencias. Las usa src/worker/routes/shopping-lists.ts y se prueban en test/core.

export const MAX_QTY = 999;

/** Nombre comparable: sin tildes, minúsculas y espacios simples. «Leche  Entera» ≡ «leche entera». */
export const normName = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Cantidad de la hoja antigua. Solo un entero limpio (1–999) se toma como cantidad; cualquier otra cosa («2 packs»,
 * «1,5», vacío) deja la cantidad en 1 y marcada como dudosa para revisarla. No se adivina.
 */
export function legacyQty(text: string | null | undefined): { qty: number; unclear: boolean } {
  const t = (text ?? '').trim();
  if (/^\d{1,3}$/.test(t)) {
    const n = Number(t);
    if (n >= 1 && n <= MAX_QTY) return { qty: n, unclear: false };
  }
  return { qty: 1, unclear: true };
}

/** «perDay» de la hoja antigua (columna extra): solo «true»/«1»/«sí» explícitos cuentan como «por día». */
export function legacyPerDay(extraJson: string | null | undefined): boolean {
  if (!extraJson) return false;
  try {
    const extra = JSON.parse(extraJson) as Record<string, unknown>;
    const raw = Object.entries(extra).find(([k]) => k.replace(/[\s_-]/g, '').toLowerCase() === 'perday')?.[1];
    return ['true', '1', 'si', 'sí', 'x', 'verdadero'].includes(String(raw ?? '').trim().toLowerCase());
  } catch {
    return false;
  }
}

export type Missing = 'product' | 'format' | 'qty' | 'price';
export const MISSING_LABEL: Record<Missing, string> = {
  product: 'falta el producto exacto: sin él no hay historial de precios',
  format: 'el producto no indica formato ni cantidad neta',
  qty: 'la cantidad de la hoja no era un número: revísala',
  price: 'sin precios registrados para este producto',
};

/** Qué le falta a un artículo general para tener precio con historial. El orden es el de resolución. */
export function missingOf(i: { productId: string | null; productFormat?: string | null; productNetQty?: number | null; qtyUnclear: boolean; priceCount?: number }): Missing[] {
  const out: Missing[] = [];
  if (!i.productId) out.push('product');
  else {
    if (!i.productFormat && i.productNetQty == null) out.push('format');
    if (!i.priceCount) out.push('price');
  }
  if (i.qtyUnclear) out.push('qty');
  return out;
}

// ---------- Copia a un viaje ----------

export interface GeneralItemLite { id: string; name: string; productId: string | null; qty: number; perDay: boolean }
export interface TripItemLite { id: string; name: string; productId: string | null; qty: number; bought: boolean; sourceListItemId: string | null }
export type MatchReason = 'already_copied' | 'same_product' | 'same_name';
export type CopyAction = 'add' | 'sum' | 'skip';

export interface CopyPlanRow {
  itemId: string;
  name: string;
  productId: string | null;
  /** Cantidad que tendría la copia en el viaje. */
  qty: number;
  /** Explicación de la cantidad cuando es «por día». */
  qtyNote: string | null;
  match: { tripItemId: string; name: string; qty: number; bought: boolean; reason: MatchReason } | null;
  /** Acciones válidas para esta fila; la primera es la propuesta. */
  actions: CopyAction[];
}

/**
 * Cantidad para el viaje. «Por día» se multiplica por los días de esquí del viaje, como hacía la hoja antigua; si el
 * viaje no los tiene, se copia la cantidad tal cual y se avisa (no se inventa un número de días).
 */
export function tripQty(i: Pick<GeneralItemLite, 'qty' | 'perDay'>, skiDays: number | null): { qty: number; note: string | null } {
  if (!i.perDay) return { qty: i.qty, note: null };
  if (skiDays == null || skiDays < 1) return { qty: i.qty, note: `${i.qty} por día; el viaje no tiene días de esquí, se copia ${i.qty}` };
  const total = Math.min(MAX_QTY, i.qty * skiDays);
  return { qty: total, note: `${i.qty} por día × ${skiDays} días de esquí${total === MAX_QTY && i.qty * skiDays > MAX_QTY ? ` (máximo ${MAX_QTY})` : ''}` };
}

/**
 * Coincidencias con lo que ya tiene el viaje, por prioridad: copia previa del mismo artículo general, mismo producto
 * exacto o, si ninguno de los dos tiene producto, mismo nombre. Cada artículo del viaje se empareja como mucho una vez.
 * Propuesta: sin coincidencia → añadir; con coincidencia → no tocar (sumar solo si sigue pendiente de comprar).
 */
export function planCopy(general: GeneralItemLite[], trip: TripItemLite[], skiDays: number | null): CopyPlanRow[] {
  const used = new Set<string>();
  const find = (pred: (t: TripItemLite) => boolean) => trip.find((t) => !used.has(t.id) && pred(t)) ?? null;
  return general.map((g) => {
    let reason: MatchReason | null = null;
    let hit = find((t) => t.sourceListItemId === g.id);
    if (hit) reason = 'already_copied';
    if (!hit && g.productId) { hit = find((t) => t.productId === g.productId); if (hit) reason = 'same_product'; }
    if (!hit && !g.productId) { const n = normName(g.name); hit = find((t) => !t.productId && normName(t.name) === n); if (hit) reason = 'same_name'; }
    if (hit) used.add(hit.id);
    const { qty, note } = tripQty(g, skiDays);
    return {
      itemId: g.id, name: g.name, productId: g.productId, qty, qtyNote: note,
      match: hit && reason ? { tripItemId: hit.id, name: hit.name, qty: hit.qty, bought: hit.bought, reason } : null,
      actions: !hit ? ['add', 'skip'] : hit.bought ? ['skip', 'add'] : ['skip', 'sum', 'add'],
    };
  });
}
