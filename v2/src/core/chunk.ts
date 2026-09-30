// Reparte un lote en partes que respetan el límite por POST de la ingesta (MAX_ITEMS = 200 filas y un máximo de
// entradas por parte). Cada elemento va entero a una sola parte; el orden se conserva.
export function chunkBy<T>(items: readonly T[], weight: (x: T) => number, maxWeight: number, maxCount = Infinity): T[][] {
  const parts: T[][] = [];
  let cur: T[] = [], w = 0;
  for (const it of items) {
    const iw = weight(it);
    if (iw > maxWeight) throw new Error(`Un elemento pesa ${iw} (> ${maxWeight}); no cabe en ninguna parte.`);
    if (cur.length && (w + iw > maxWeight || cur.length >= maxCount)) { parts.push(cur); cur = []; w = 0; }
    cur.push(it); w += iw;
  }
  if (cur.length || !parts.length) parts.push(cur);
  return parts;
}
