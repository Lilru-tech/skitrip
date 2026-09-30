// Alias público: se muestra tal cual, pero la unicidad se decide sobre la forma normalizada
// (NFKD sin diacríticos, minúsculas), así «Núria» y «nuria» no pueden coexistir.
const ALIAS_RE = /^[\p{L}\p{N}._-]{3,24}$/u;

export function normalizeAlias(alias: string): string {
  return alias.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function validateAlias(raw: string): { ok: true; alias: string; norm: string } | { ok: false; reason: string } {
  const alias = raw.normalize('NFC').trim();
  if (!ALIAS_RE.test(alias)) {
    return { ok: false, reason: 'El alias debe tener entre 3 y 24 caracteres: letras, números, punto, guion o guion bajo.' };
  }
  const norm = normalizeAlias(alias);
  if (!/[\p{L}\p{N}]/u.test(norm)) return { ok: false, reason: 'El alias debe contener alguna letra o número.' };
  return { ok: true, alias, norm };
}
